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

// SavedConversationService handles bookmarking telemetry conversations and creating
// manual test conversations for evaluation.
type SavedConversationService struct {
	store         evalpkg.SavedConversationStore
	convLookup    ConversationLookup
	manualWriter  ManualConversationWriter
	manualDeleter ManualConversationDeleter
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
		return nil, newValidationError(errors.New("tenant id is required"))
	}
	if trimmedSavedID == "" {
		return nil, newValidationError(errors.New("saved_id is required"))
	}
	if trimmedConvID == "" {
		return nil, newValidationError(errors.New("conversation_id is required"))
	}
	if trimmedName == "" {
		return nil, newValidationError(errors.New("name is required"))
	}
	if trimmedSavedBy == "" {
		return nil, newValidationError(errors.New("saved_by is required"))
	}
	if s.convLookup == nil {
		return nil, errors.New("conversation lookup is not configured")
	}

	conv, err := s.convLookup.GetConversation(ctx, trimmedTenantID, trimmedConvID)
	if err != nil {
		return nil, fmt.Errorf("lookup conversation: %w", err)
	}
	if conv == nil {
		return nil, newValidationError(fmt.Errorf("conversation %q not found", trimmedConvID))
	}

	tags := req.Tags
	if tags == nil {
		tags = map[string]string{}
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
		return nil, newValidationError(errors.New("tenant id is required"))
	}
	if trimmedSavedID == "" {
		return nil, newValidationError(errors.New("saved_id is required"))
	}
	if trimmedName == "" {
		return nil, newValidationError(errors.New("name is required"))
	}
	if trimmedSavedBy == "" {
		return nil, newValidationError(errors.New("saved_by is required"))
	}
	if len(req.Generations) == 0 {
		return nil, newValidationError(errors.New("at least one generation is required"))
	}
	for i, gen := range req.Generations {
		if strings.TrimSpace(gen.GenerationID) == "" {
			return nil, newValidationError(fmt.Errorf("generation[%d]: generation_id is required", i))
		}
		if len(gen.Input) == 0 {
			return nil, newValidationError(fmt.Errorf("generation[%d]: at least one input message is required", i))
		}
		if len(gen.Output) == 0 {
			return nil, newValidationError(fmt.Errorf("generation[%d]: at least one output message is required", i))
		}
	}
	if s.manualWriter == nil {
		return nil, errors.New("manual conversation writer is not configured")
	}

	conversationID := fmt.Sprintf("conv_manual_%s", trimmedSavedID)

	if err := s.manualWriter.CreateManualConversation(ctx, trimmedTenantID, conversationID, req.Generations); err != nil {
		return nil, fmt.Errorf("create manual conversation data: %w", err)
	}

	tags := req.Tags
	if tags == nil {
		tags = map[string]string{}
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

// ListSavedConversations returns saved conversations for a tenant, optionally filtered by source.
func (s *SavedConversationService) ListSavedConversations(ctx context.Context, tenantID, source string, limit int, cursor uint64) ([]evalpkg.SavedConversation, uint64, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return nil, 0, newValidationError(errors.New("tenant id is required"))
	}
	trimmedSource := strings.TrimSpace(source)
	if trimmedSource != "" && !evalpkg.IsValidSavedConversationSource(trimmedSource) {
		return nil, 0, newValidationError(fmt.Errorf("invalid source %q", trimmedSource))
	}
	return s.store.ListSavedConversations(ctx, trimmedTenantID, trimmedSource, limit, cursor)
}

// GetSavedConversation returns a single saved conversation by ID.
func (s *SavedConversationService) GetSavedConversation(ctx context.Context, tenantID, savedID string) (*evalpkg.SavedConversation, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedSavedID := strings.TrimSpace(savedID)
	if trimmedTenantID == "" {
		return nil, newValidationError(errors.New("tenant id is required"))
	}
	if trimmedSavedID == "" {
		return nil, newValidationError(errors.New("saved_id is required"))
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
		return newValidationError(errors.New("tenant id is required"))
	}
	if trimmedSavedID == "" {
		return newValidationError(errors.New("saved_id is required"))
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

	return s.store.DeleteSavedConversation(ctx, trimmedTenantID, trimmedSavedID)
}
