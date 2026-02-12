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

type WALCompactor interface {
	ClaimUncompacted(ctx context.Context, tenantID string, olderThan time.Time, limit int) ([]*sigilv1.Generation, error)
	MarkCompacted(ctx context.Context, tenantID string, generationIDs []string) error
}

type WALTruncator interface {
	TruncateCompacted(ctx context.Context, tenantID string, olderThan time.Time, limit int) (int64, error)
}
