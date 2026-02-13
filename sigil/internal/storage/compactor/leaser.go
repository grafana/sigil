package compactor

import (
	"context"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
)

type TenantDiscoverer interface {
	ListShardsForCompaction(ctx context.Context, shardWindowSeconds int, shardCount int, limit int) ([]storage.TenantShard, error)
	ListShardsForTruncation(ctx context.Context, shardWindowSeconds int, shardCount int, olderThan time.Time, limit int) ([]storage.TenantShard, error)
}

type TenantLeaser interface {
	AcquireLease(ctx context.Context, tenantID string, shardID int, ownerID string, ttl time.Duration) (held bool, currentOwnerID string, expiresAt time.Time, err error)
	RenewLease(ctx context.Context, tenantID string, shardID int, ownerID string, ttl time.Duration) (held bool, currentOwnerID string, expiresAt time.Time, err error)
}

type Claimer interface {
	ClaimBatch(
		ctx context.Context,
		tenantID string,
		ownerID string,
		shard storage.ShardPredicate,
		olderThan time.Time,
		limit int,
	) (int, error)
	LoadClaimed(
		ctx context.Context,
		tenantID string,
		ownerID string,
		shard storage.ShardPredicate,
		limit int,
	) ([]*sigilv1.Generation, []uint64, error)
	FinalizeClaimed(ctx context.Context, tenantID string, ownerID string, ids []uint64) error
	ReleaseStaleClaims(ctx context.Context, claimTTL time.Duration) (int64, error)
}

type Truncator interface {
	TruncateCompacted(ctx context.Context, tenantID string, shard storage.ShardPredicate, olderThan time.Time, limit int) (int64, error)
}
