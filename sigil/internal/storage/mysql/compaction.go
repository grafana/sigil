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

	var deletedRows int64
	err := runWithRetryableLockError(ctx, func() error {
		// Select candidate IDs first so delete locks follow a stable primary-key order.
		query := `
DELETE g
FROM generations AS g
JOIN (
	SELECT id
	FROM (
		SELECT id
		FROM generations FORCE INDEX (idx_generations_tenant_compacted_compacted_at_id)
		WHERE tenant_id = ?
		  AND compacted = TRUE
		  AND compacted_at IS NOT NULL
		  AND compacted_at <= ?`
		args := []any{tenantID, olderThan.UTC()}
		if shard.ShardCount > 1 {
			query += `
		  AND (FLOOR(UNIX_TIMESTAMP(created_at) / ?) % ?) = ?`
			args = append(args,
				shard.ShardWindowSeconds,
				shard.ShardCount,
				shard.ShardID,
			)
		}
		query += `
		ORDER BY id ASC
		LIMIT ?
	) AS picked_ids
) AS to_delete ON to_delete.id = g.id`
		args = append(args, limit)

		result := s.db.WithContext(ctx).Exec(query, args...)
		if result.Error != nil {
			return result.Error
		}
		deletedRows = result.RowsAffected
		return nil
	})
	if err != nil {
		observeWALMetrics("truncate_compacted", "error", start, 0)
		return 0, fmt.Errorf("truncate compacted rows: %w", err)
	}

	observeWALMetrics("truncate_compacted", "success", start, int(deletedRows))
	return deletedRows, nil
}
