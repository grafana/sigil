package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/storage"
)

func (s *WALStore) TruncateCompacted(ctx context.Context, tenantID string, shard storage.ShardPredicate, olderThan time.Time, limit int) (int64, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("truncate_compacted", "error", start, 0)
		return 0, errors.New("tenant id is required")
	}
	if shard.ShardWindowSeconds <= 0 {
		observeWALMetrics("truncate_compacted", "error", start, 0)
		return 0, errors.New("shard window seconds must be > 0")
	}
	if shard.ShardCount <= 0 {
		observeWALMetrics("truncate_compacted", "error", start, 0)
		return 0, errors.New("shard count must be > 0")
	}
	if shard.ShardID < 0 || shard.ShardID >= shard.ShardCount {
		observeWALMetrics("truncate_compacted", "error", start, 0)
		return 0, errors.New("shard id must be in [0, shard_count)")
	}
	if limit <= 0 {
		observeWALMetrics("truncate_compacted", "success", start, 0)
		return 0, nil
	}

	// Use raw SQL for deterministic ordered/batched delete behavior in MySQL.
	result := s.db.WithContext(ctx).Exec(`
DELETE FROM generations
WHERE tenant_id = ?
  AND compacted = TRUE
  AND compacted_at IS NOT NULL
  AND compacted_at <= ?
  AND (FLOOR(UNIX_TIMESTAMP(created_at) / ?) % ?) = ?
ORDER BY id ASC
LIMIT ?`, tenantID, olderThan.UTC(), shard.ShardWindowSeconds, shard.ShardCount, shard.ShardID, limit)
	if result.Error != nil {
		observeWALMetrics("truncate_compacted", "error", start, 0)
		return 0, fmt.Errorf("truncate compacted rows: %w", result.Error)
	}

	observeWALMetrics("truncate_compacted", "success", start, int(result.RowsAffected))
	return result.RowsAffected, nil
}
