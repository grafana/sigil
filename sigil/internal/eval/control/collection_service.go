package control

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

// Request/response types for collection operations.

type CreateCollectionRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	CreatedBy   string `json:"created_by"`
}

type UpdateCollectionRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	UpdatedBy   string  `json:"updated_by"`
}

type AddMembersRequest struct {
	SavedIDs []string `json:"saved_ids"`
	AddedBy  string   `json:"added_by"`
}

// CollectionService manages collection CRUD and membership.
type CollectionService struct {
	store   evalpkg.CollectionStore
	scStore evalpkg.SavedConversationStore
}

func NewCollectionService(store evalpkg.CollectionStore, scStore evalpkg.SavedConversationStore) *CollectionService {
	return &CollectionService{store: store, scStore: scStore}
}

// CreateCollection creates a new collection with the given name and description.
func (s *CollectionService) CreateCollection(ctx context.Context, tenantID string, req CreateCollectionRequest) (*evalpkg.Collection, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedName := strings.TrimSpace(req.Name)
	trimmedDescription := strings.TrimSpace(req.Description)
	trimmedCreatedBy := strings.TrimSpace(req.CreatedBy)

	if trimmedTenantID == "" {
		return nil, ValidationError("tenant_id is required")
	}
	if trimmedName == "" {
		return nil, ValidationError("name is required")
	}
	if trimmedCreatedBy == "" {
		return nil, ValidationError("created_by is required")
	}

	collectionID := uuid.New().String()

	c := evalpkg.Collection{
		TenantID:     trimmedTenantID,
		CollectionID: collectionID,
		Name:         trimmedName,
		Description:  trimmedDescription,
		CreatedBy:    trimmedCreatedBy,
		UpdatedBy:    trimmedCreatedBy,
	}

	if err := s.store.CreateCollection(ctx, c); err != nil {
		return nil, err
	}

	created, err := s.store.GetCollection(ctx, trimmedTenantID, collectionID)
	if err != nil {
		return nil, err
	}
	if created == nil {
		return nil, fmt.Errorf("created collection %q was not found", collectionID)
	}
	return created, nil
}

// GetCollection returns a single collection by ID.
func (s *CollectionService) GetCollection(ctx context.Context, tenantID, collectionID string) (*evalpkg.Collection, error) {
	c, err := s.store.GetCollection(ctx, tenantID, collectionID)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, NotFoundError(fmt.Sprintf("collection %q not found", collectionID))
	}
	return c, nil
}

// ListCollections returns collections for a tenant with cursor-based pagination.
func (s *CollectionService) ListCollections(ctx context.Context, tenantID string, limit int, cursor string) ([]evalpkg.Collection, string, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	return s.store.ListCollections(ctx, tenantID, limit, cursor)
}

// UpdateCollection patches a collection's name and/or description.
func (s *CollectionService) UpdateCollection(ctx context.Context, tenantID, collectionID string, req UpdateCollectionRequest) error {
	trimmedUpdatedBy := strings.TrimSpace(req.UpdatedBy)
	if trimmedUpdatedBy == "" {
		return ValidationError("updated_by is required")
	}

	var namePtr *string
	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			return ValidationError("name must not be empty")
		}
		namePtr = &trimmed
	}

	var descPtr *string
	if req.Description != nil {
		trimmed := strings.TrimSpace(*req.Description)
		descPtr = &trimmed
	}

	err := s.store.UpdateCollection(ctx, tenantID, collectionID, namePtr, descPtr, &trimmedUpdatedBy)
	if err != nil {
		if isNotFoundError(err) {
			return NotFoundError(fmt.Sprintf("collection %q not found", collectionID))
		}
		return err
	}
	return nil
}

// DeleteCollection removes a collection and its membership data.
func (s *CollectionService) DeleteCollection(ctx context.Context, tenantID, collectionID string) error {
	return s.store.DeleteCollection(ctx, tenantID, collectionID)
}

// AddMembers adds saved conversations to a collection after verifying they exist.
func (s *CollectionService) AddMembers(ctx context.Context, tenantID, collectionID string, req AddMembersRequest) error {
	trimmedAddedBy := strings.TrimSpace(req.AddedBy)
	if len(req.SavedIDs) == 0 {
		return ValidationError("saved_ids must not be empty")
	}
	if trimmedAddedBy == "" {
		return ValidationError("added_by is required")
	}

	// Verify collection exists.
	c, err := s.store.GetCollection(ctx, tenantID, collectionID)
	if err != nil {
		return err
	}
	if c == nil {
		return NotFoundError(fmt.Sprintf("collection %q not found", collectionID))
	}

	// Verify each saved conversation exists.
	for _, savedID := range req.SavedIDs {
		sc, err := s.scStore.GetSavedConversation(ctx, tenantID, savedID)
		if err != nil {
			return err
		}
		if sc == nil {
			return ValidationError(fmt.Sprintf("saved conversation %q not found", savedID))
		}
	}

	return s.store.AddCollectionMembers(ctx, tenantID, collectionID, req.SavedIDs, trimmedAddedBy)
}

// RemoveMember removes a single saved conversation from a collection.
func (s *CollectionService) RemoveMember(ctx context.Context, tenantID, collectionID, savedID string) error {
	return s.store.RemoveCollectionMember(ctx, tenantID, collectionID, savedID)
}

// ListMembers returns saved conversations belonging to a collection.
func (s *CollectionService) ListMembers(ctx context.Context, tenantID, collectionID string, limit int, cursor string) ([]evalpkg.SavedConversation, string, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	return s.store.ListCollectionMembers(ctx, tenantID, collectionID, limit, cursor)
}

// ListCollectionsForSavedConversation returns all collections that contain the given saved conversation.
func (s *CollectionService) ListCollectionsForSavedConversation(ctx context.Context, tenantID, savedID string) ([]evalpkg.Collection, error) {
	return s.store.ListCollectionsForSavedConversation(ctx, tenantID, savedID)
}
