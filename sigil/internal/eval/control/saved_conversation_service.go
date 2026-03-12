package control

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/storage"
)

// ConversationLookup resolves whether a conversation exists.
type ConversationLookup interface {
	GetConversation(ctx context.Context, tenantID, conversationID string) (*storage.Conversation, error)
}

// ManualConversationWriter creates conversation and generation rows for manual test data.
type ManualConversationWriter interface {
	CreateManualConversation(ctx context.Context, tenantID, conversationID string, generations []ManualGeneration) error
}

// ManualConversationDeleter removes conversation and generation rows for manual test data.
type ManualConversationDeleter interface {
	DeleteManualConversationData(ctx context.Context, tenantID, conversationID string) error
}

// ManualGeneration describes a single generation in a manually created conversation.
type ManualGeneration struct {
	GenerationID  string          `json:"generation_id"`
	OperationName string          `json:"operation_name"`
	Mode          string          `json:"mode"`
	Model         ManualModelRef  `json:"model"`
	Input         []ManualMessage `json:"input"`
	Output        []ManualMessage `json:"output"`
	StartedAt     *time.Time      `json:"started_at,omitempty"`
	CompletedAt   *time.Time      `json:"completed_at,omitempty"`
}

// ManualModelRef identifies the model used for a manual generation.
type ManualModelRef struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
}

// ManualMessage is a single input or output message in a manual generation.
type ManualMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// SaveConversationRequest is the input for bookmarking an existing telemetry conversation.
type SaveConversationRequest struct {
	SavedID        string            `json:"saved_id"`
	ConversationID string            `json:"conversation_id"`
	Name           string            `json:"name"`
	Tags           map[string]string `json:"tags"`
	SavedBy        string            `json:"saved_by"`
}

// CreateManualConversationRequest is the input for creating a manual test conversation.
type CreateManualConversationRequest struct {
	SavedID     string             `json:"saved_id"`
	Name        string             `json:"name"`
	Tags        map[string]string  `json:"tags"`
	SavedBy     string             `json:"saved_by"`
	Generations []ManualGeneration `json:"generations"`
}

// SavedConversationServiceOption configures optional dependencies on SavedConversationService.
type SavedConversationServiceOption func(*SavedConversationService)

// WithManualWriter configures the SavedConversationService to create manual conversation data.
func WithManualWriter(w ManualConversationWriter) SavedConversationServiceOption {
	return func(s *SavedConversationService) { s.manualWriter = w }
}

// WithManualDeleter configures the SavedConversationService to cascade-delete manual conversation data.
func WithManualDeleter(d ManualConversationDeleter) SavedConversationServiceOption {
	return func(s *SavedConversationService) { s.manualDeleter = d }
}

// CollectionLister lists collections for a saved conversation.
type CollectionLister interface {
	ListCollectionsForSavedConversation(ctx context.Context, tenantID, savedID string) ([]evalpkg.Collection, error)
}

// CollectionMemberCleaner cleans up collection memberships for a saved conversation.
type CollectionMemberCleaner interface {
	DeleteCollectionMembersBySavedID(ctx context.Context, tenantID, savedID string) error
}

// WithCollectionMemberCleaner configures cascade cleanup of collection memberships.
func WithCollectionMemberCleaner(c CollectionMemberCleaner) SavedConversationServiceOption {
	return func(s *SavedConversationService) { s.collectionCleaner = c }
}

// SavedConversationService handles bookmarking telemetry conversations and creating
// manual test conversations for evaluation.
type SavedConversationService struct {
	store             evalpkg.SavedConversationStore
	convLookup        ConversationLookup
	manualWriter      ManualConversationWriter
	manualDeleter     ManualConversationDeleter
	collectionLister  CollectionLister
	collectionCleaner CollectionMemberCleaner
}

// SetCollectionLister sets the collection lister for reverse lookup.
func (s *SavedConversationService) SetCollectionLister(cl CollectionLister) {
	s.collectionLister = cl
}

func (s *SavedConversationService) duplicateSavedConversationConflict(
	ctx context.Context,
	tenantID string,
	savedID string,
	conversationID string,
) error {
	const fallbackMessage = "saved conversation already exists"

	existing, err := s.store.GetSavedConversation(ctx, tenantID, savedID)
	if err != nil {
		return ConflictError(fallbackMessage)
	}
	if existing != nil {
		return ConflictError(fmt.Sprintf("saved conversation %q already exists", savedID))
	}
	existingForConversation, err := s.store.GetSavedConversationByConversationID(ctx, tenantID, conversationID)
	if err != nil {
		return ConflictError(fallbackMessage)
	}
	if existingForConversation != nil {
		return ConflictError(fmt.Sprintf("conversation %q is already saved as %q", conversationID, existingForConversation.SavedID))
	}
	return ConflictError(fallbackMessage)
}

// NewSavedConversationService creates a SavedConversationService with the required store
// and conversation lookup, plus optional manual writer/deleter.
func NewSavedConversationService(store evalpkg.SavedConversationStore, convLookup ConversationLookup, opts ...SavedConversationServiceOption) *SavedConversationService {
	s := &SavedConversationService{store: store, convLookup: convLookup}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// SaveConversation bookmarks an existing telemetry conversation.
func (s *SavedConversationService) SaveConversation(ctx context.Context, tenantID string, req SaveConversationRequest) (*evalpkg.SavedConversation, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedSavedID := strings.TrimSpace(req.SavedID)
	trimmedConvID := strings.TrimSpace(req.ConversationID)
	trimmedName := strings.TrimSpace(req.Name)
	trimmedSavedBy := strings.TrimSpace(req.SavedBy)

	if trimmedTenantID == "" {
		return nil, ValidationWrap(errors.New("tenant id is required"))
	}
	if trimmedSavedID == "" {
		return nil, ValidationWrap(errors.New("saved_id is required"))
	}
	if err := validateSavedConversationID(trimmedSavedID); err != nil {
		return nil, ValidationWrap(err)
	}
	if trimmedConvID == "" {
		return nil, ValidationWrap(errors.New("conversation_id is required"))
	}
	if trimmedName == "" {
		return nil, ValidationWrap(errors.New("name is required"))
	}
	if trimmedSavedBy == "" {
		return nil, ValidationWrap(errors.New("saved_by is required"))
	}
	if s.convLookup == nil {
		return nil, UnavailableError("conversation lookup is not configured", errors.New("conversation lookup is not configured"))
	}
	tags, err := validateSavedConversationTags(req.Tags)
	if err != nil {
		return nil, ValidationWrap(err)
	}
	existing, err := s.store.GetSavedConversation(ctx, trimmedTenantID, trimmedSavedID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ConflictError(fmt.Sprintf("saved conversation %q already exists", trimmedSavedID))
	}
	existingForConversation, err := s.store.GetSavedConversationByConversationID(ctx, trimmedTenantID, trimmedConvID)
	if err != nil {
		return nil, err
	}
	if existingForConversation != nil {
		return nil, ConflictError(fmt.Sprintf("conversation %q is already saved as %q", trimmedConvID, existingForConversation.SavedID))
	}

	conv, err := s.convLookup.GetConversation(ctx, trimmedTenantID, trimmedConvID)
	if err != nil {
		return nil, fmt.Errorf("lookup conversation: %w", err)
	}
	if conv == nil {
		return nil, NotFoundError(fmt.Sprintf("conversation %q not found", trimmedConvID))
	}

	sc := evalpkg.SavedConversation{
		TenantID:       trimmedTenantID,
		SavedID:        trimmedSavedID,
		ConversationID: trimmedConvID,
		Name:           trimmedName,
		Source:         evalpkg.SavedConversationSourceTelemetry,
		Tags:           tags,
		SavedBy:        trimmedSavedBy,
	}

	if err := s.store.CreateSavedConversation(ctx, sc); err != nil {
		if errors.Is(err, evalpkg.ErrConflict) {
			return nil, s.duplicateSavedConversationConflict(ctx, trimmedTenantID, trimmedSavedID, trimmedConvID)
		}
		return nil, err
	}

	created, err := s.store.GetSavedConversation(ctx, trimmedTenantID, trimmedSavedID)
	if err != nil {
		return nil, err
	}
	if created == nil {
		return nil, fmt.Errorf("created saved conversation %q was not found", trimmedSavedID)
	}
	return created, nil
}

// CreateManualConversation creates a manual test conversation with inline generation data.
func (s *SavedConversationService) CreateManualConversation(ctx context.Context, tenantID string, req CreateManualConversationRequest) (*evalpkg.SavedConversation, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedSavedID := strings.TrimSpace(req.SavedID)
	trimmedName := strings.TrimSpace(req.Name)
	trimmedSavedBy := strings.TrimSpace(req.SavedBy)

	if trimmedTenantID == "" {
		return nil, ValidationWrap(errors.New("tenant id is required"))
	}
	if trimmedSavedID == "" {
		return nil, ValidationWrap(errors.New("saved_id is required"))
	}
	if err := validateSavedConversationID(trimmedSavedID); err != nil {
		return nil, ValidationWrap(err)
	}
	if trimmedName == "" {
		return nil, ValidationWrap(errors.New("name is required"))
	}
	if trimmedSavedBy == "" {
		return nil, ValidationWrap(errors.New("saved_by is required"))
	}
	tags, err := validateSavedConversationTags(req.Tags)
	if err != nil {
		return nil, ValidationWrap(err)
	}
	normalizedGenerations := append([]ManualGeneration(nil), req.Generations...)
	if err := validateManualGenerations(normalizedGenerations); err != nil {
		return nil, ValidationWrap(err)
	}
	existing, err := s.store.GetSavedConversation(ctx, trimmedTenantID, trimmedSavedID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ConflictError(fmt.Sprintf("saved conversation %q already exists", trimmedSavedID))
	}
	if s.manualWriter == nil {
		return nil, UnavailableError("manual conversation writer is not configured", errors.New("manual conversation writer is not configured"))
	}
	if s.manualDeleter == nil {
		return nil, UnavailableError("manual conversation deleter is not configured", errors.New("manual conversation deleter is not configured"))
	}

	conversationID := fmt.Sprintf("conv_manual_%s", trimmedSavedID)
	existingForConversation, err := s.store.GetSavedConversationByConversationID(ctx, trimmedTenantID, conversationID)
	if err != nil {
		return nil, err
	}
	if existingForConversation != nil {
		return nil, ConflictError(fmt.Sprintf("conversation %q is already saved as %q", conversationID, existingForConversation.SavedID))
	}

	if err := s.manualWriter.CreateManualConversation(ctx, trimmedTenantID, conversationID, normalizedGenerations); err != nil {
		return nil, fmt.Errorf("create manual conversation data: %w", err)
	}

	sc := evalpkg.SavedConversation{
		TenantID:       trimmedTenantID,
		SavedID:        trimmedSavedID,
		ConversationID: conversationID,
		Name:           trimmedName,
		Source:         evalpkg.SavedConversationSourceManual,
		Tags:           tags,
		SavedBy:        trimmedSavedBy,
	}

	if err := s.store.CreateSavedConversation(ctx, sc); err != nil {
		resultErr := err
		if errors.Is(err, evalpkg.ErrConflict) {
			resultErr = s.duplicateSavedConversationConflict(ctx, trimmedTenantID, trimmedSavedID, conversationID)
		}
		if rollbackErr := s.manualDeleter.DeleteManualConversationData(ctx, trimmedTenantID, conversationID); rollbackErr != nil {
			return nil, fmt.Errorf("%w (rollback manual conversation data: %v)", resultErr, rollbackErr)
		}
		return nil, resultErr
	}

	created, err := s.store.GetSavedConversation(ctx, trimmedTenantID, trimmedSavedID)
	if err != nil {
		return nil, err
	}
	if created == nil {
		return nil, fmt.Errorf("created saved conversation %q was not found", trimmedSavedID)
	}
	return created, nil
}

// CountSavedConversations returns the total number of saved conversations for a tenant.
func (s *SavedConversationService) CountSavedConversations(ctx context.Context, tenantID, source string) (int64, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return 0, ValidationWrap(errors.New("tenant id is required"))
	}
	trimmedSource := strings.TrimSpace(source)
	if trimmedSource != "" && !evalpkg.IsValidSavedConversationSource(trimmedSource) {
		return 0, ValidationWrap(fmt.Errorf("invalid source %q", trimmedSource))
	}
	return s.store.CountSavedConversations(ctx, trimmedTenantID, trimmedSource)
}

// ListSavedConversations returns saved conversations for a tenant, optionally filtered by source.
func (s *SavedConversationService) ListSavedConversations(ctx context.Context, tenantID, source string, limit int, cursor uint64) ([]evalpkg.SavedConversation, uint64, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return nil, 0, ValidationWrap(errors.New("tenant id is required"))
	}
	trimmedSource := strings.TrimSpace(source)
	if trimmedSource != "" && !evalpkg.IsValidSavedConversationSource(trimmedSource) {
		return nil, 0, ValidationWrap(fmt.Errorf("invalid source %q", trimmedSource))
	}
	return s.store.ListSavedConversations(ctx, trimmedTenantID, trimmedSource, limit, cursor)
}

// GetSavedConversation returns a single saved conversation by ID.
func (s *SavedConversationService) GetSavedConversation(ctx context.Context, tenantID, savedID string) (*evalpkg.SavedConversation, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedSavedID := strings.TrimSpace(savedID)
	if trimmedTenantID == "" {
		return nil, ValidationWrap(errors.New("tenant id is required"))
	}
	if trimmedSavedID == "" {
		return nil, ValidationWrap(errors.New("saved_id is required"))
	}
	return s.store.GetSavedConversation(ctx, trimmedTenantID, trimmedSavedID)
}

// DeleteSavedConversation removes a saved conversation. For manual conversations,
// it also cascade-deletes the underlying conversation and generation data if a
// ManualConversationDeleter is configured.
func (s *SavedConversationService) DeleteSavedConversation(ctx context.Context, tenantID, savedID string) error {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedSavedID := strings.TrimSpace(savedID)
	if trimmedTenantID == "" {
		return ValidationWrap(errors.New("tenant id is required"))
	}
	if trimmedSavedID == "" {
		return ValidationWrap(errors.New("saved_id is required"))
	}

	existing, err := s.store.GetSavedConversation(ctx, trimmedTenantID, trimmedSavedID)
	if err != nil {
		return err
	}
	if existing == nil {
		return nil // idempotent
	}

	if existing.Source == evalpkg.SavedConversationSourceManual && s.manualDeleter != nil {
		if err := s.manualDeleter.DeleteManualConversationData(ctx, trimmedTenantID, existing.ConversationID); err != nil {
			return fmt.Errorf("delete manual conversation data: %w", err)
		}
	}

	if s.collectionCleaner != nil {
		if err := s.collectionCleaner.DeleteCollectionMembersBySavedID(ctx, trimmedTenantID, trimmedSavedID); err != nil {
			return fmt.Errorf("delete collection memberships: %w", err)
		}
	}

	return s.store.DeleteSavedConversation(ctx, trimmedTenantID, trimmedSavedID)
}
