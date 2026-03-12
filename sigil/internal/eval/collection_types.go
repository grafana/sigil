package eval

import (
	"context"
	"time"
)

// Collection is a named group of saved conversations.
type Collection struct {
	TenantID     string    `json:"tenant_id"`
	CollectionID string    `json:"collection_id"`
	Name         string    `json:"name"`
	Description  string    `json:"description,omitempty"`
	CreatedBy    string    `json:"created_by"`
	UpdatedBy    string    `json:"updated_by"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	MemberCount  int       `json:"member_count"`
}

// CollectionMember links a saved conversation to a collection.
type CollectionMember struct {
	TenantID     string    `json:"tenant_id"`
	CollectionID string    `json:"collection_id"`
	SavedID      string    `json:"saved_id"`
	AddedBy      string    `json:"added_by"`
	CreatedAt    time.Time `json:"created_at"`
}

// CollectionStore persists collection and membership data.
type CollectionStore interface {
	CreateCollection(ctx context.Context, c Collection) error
	GetCollection(ctx context.Context, tenantID, collectionID string) (*Collection, error)
	ListCollections(ctx context.Context, tenantID string, limit int, cursor string) ([]Collection, string, error)
	UpdateCollection(ctx context.Context, tenantID, collectionID string, name, description, updatedBy *string) error
	DeleteCollection(ctx context.Context, tenantID, collectionID string) error

	AddCollectionMembers(ctx context.Context, tenantID, collectionID string, savedIDs []string, addedBy string) error
	RemoveCollectionMember(ctx context.Context, tenantID, collectionID, savedID string) error
	ListCollectionMembers(ctx context.Context, tenantID, collectionID string, limit int, cursor string) ([]SavedConversation, string, error)
	ListCollectionsForSavedConversation(ctx context.Context, tenantID, savedID string) ([]Collection, error)
	DeleteCollectionMembersBySavedID(ctx context.Context, tenantID, savedID string) error
}
