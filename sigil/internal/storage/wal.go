package storage

import (
	"context"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

type WALWriter interface {
	SaveBatch(ctx context.Context, tenantID string, generations []*sigilv1.Generation) []error
}

type WALReader interface {
	GetByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error)
	GetByConversationID(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error)
}

type WALTruncator interface {
	TruncateCompacted(ctx context.Context, tenantID string, shard ShardPredicate, olderThan time.Time, limit int) (int64, error)
}

// RecentGenerationRow holds minimal generation data for rule preview.
type RecentGenerationRow struct {
	GenerationID   string
	ConversationID *string
	Payload        []byte
	CreatedAt      time.Time
}

// RecentGenerationLister lists generations for a tenant within a time window.
type RecentGenerationLister interface {
	ListRecentGenerations(ctx context.Context, tenantID string, since time.Time, limit int) ([]RecentGenerationRow, error)
}
