package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/storage"
	"gorm.io/gorm"
)

func (s *WALStore) ListShardsForCompaction(ctx context.Context, shardWindowSeconds int, shardCount int, limit int) ([]storage.TenantShard, error) {
	start := time.Now()
	if err := validateShardWindow(shardWindowSeconds, shardCount); err != nil {
		observeWALMetrics("list_shards_compaction", "error", start, 0)
		return nil, err
	}
	if limit <= 0 {
		observeWALMetrics("list_shards_compaction", "success", start, 0)
		return []storage.TenantShard{}, nil
	}

	now := time.Now().UTC()
	rows, err := s.db.WithContext(ctx).Raw(`
SELECT tenant_id,
       -- CAST avoids DECIMAL scan behavior from FLOOR()/mod arithmetic.
       CAST((FLOOR(UNIX_TIMESTAMP(created_at) / ?) % ?) AS SIGNED) AS shard_id,
       COUNT(*) AS backlog
FROM generations
WHERE compacted = FALSE
  AND claimed_by IS NULL
  AND created_at <= ?
GROUP BY tenant_id, shard_id
ORDER BY backlog DESC, tenant_id ASC, shard_id ASC
LIMIT ?`, shardWindowSeconds, shardCount, now, limit).Rows()
	if err != nil {
		observeWALMetrics("list_shards_compaction", "error", start, 0)
		return nil, fmt.Errorf("query shards for compaction: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	shards := make([]storage.TenantShard, 0, limit)
	for rows.Next() {
		var (
			tenantID string
			shardID  int
			backlog  int64
		)
		if err := rows.Scan(&tenantID, &shardID, &backlog); err != nil {
			observeWALMetrics("list_shards_compaction", "error", start, len(shards))
			return nil, fmt.Errorf("scan compaction shard: %w", err)
		}
		tenantID = strings.TrimSpace(tenantID)
		if tenantID == "" {
			continue
		}
		shards = append(shards, storage.TenantShard{
			TenantID: tenantID,
			ShardID:  shardID,
			Backlog:  int(backlog),
		})
	}
	if err := rows.Err(); err != nil {
		observeWALMetrics("list_shards_compaction", "error", start, len(shards))
		return nil, fmt.Errorf("iterate compaction shards: %w", err)
	}

	observeWALMetrics("list_shards_compaction", "success", start, len(shards))
	return shards, nil
}

func (s *WALStore) ListShardsForTruncation(ctx context.Context, shardWindowSeconds int, shardCount int, olderThan time.Time, limit int) ([]storage.TenantShard, error) {
	start := time.Now()
	if err := validateShardWindow(shardWindowSeconds, shardCount); err != nil {
		observeWALMetrics("list_shards_truncation", "error", start, 0)
		return nil, err
	}
	if limit <= 0 {
		observeWALMetrics("list_shards_truncation", "success", start, 0)
		return []storage.TenantShard{}, nil
	}

	rows, err := s.db.WithContext(ctx).Raw(`
SELECT tenant_id,
       -- CAST avoids DECIMAL scan behavior from FLOOR()/mod arithmetic.
       CAST((FLOOR(UNIX_TIMESTAMP(created_at) / ?) % ?) AS SIGNED) AS shard_id,
       COUNT(*) AS backlog
FROM generations
WHERE compacted = TRUE
  AND compacted_at IS NOT NULL
  AND compacted_at <= ?
GROUP BY tenant_id, shard_id
ORDER BY backlog DESC, tenant_id ASC, shard_id ASC
LIMIT ?`, shardWindowSeconds, shardCount, olderThan.UTC(), limit).Rows()
	if err != nil {
		observeWALMetrics("list_shards_truncation", "error", start, 0)
		return nil, fmt.Errorf("query shards for truncation: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	shards := make([]storage.TenantShard, 0, limit)
	for rows.Next() {
		var (
			tenantID string
			shardID  int
			backlog  int64
		)
		if err := rows.Scan(&tenantID, &shardID, &backlog); err != nil {
			observeWALMetrics("list_shards_truncation", "error", start, len(shards))
			return nil, fmt.Errorf("scan truncation shard: %w", err)
		}
		tenantID = strings.TrimSpace(tenantID)
		if tenantID == "" {
			continue
		}
		shards = append(shards, storage.TenantShard{
			TenantID: tenantID,
			ShardID:  shardID,
			Backlog:  int(backlog),
		})
	}
	if err := rows.Err(); err != nil {
		observeWALMetrics("list_shards_truncation", "error", start, len(shards))
		return nil, fmt.Errorf("iterate truncation shards: %w", err)
	}

	observeWALMetrics("list_shards_truncation", "success", start, len(shards))
	return shards, nil
}

func (s *WALStore) AcquireLease(ctx context.Context, tenantID string, shardID int, ownerID string, ttl time.Duration) (bool, string, time.Time, error) {
	start := time.Now()
	if err := validateLeaseInput(tenantID, ownerID, ttl); err != nil {
		observeWALMetrics("acquire_lease", "error", start, 0)
		return false, "", time.Time{}, err
	}
	if shardID < 0 {
		observeWALMetrics("acquire_lease", "error", start, 0)
		return false, "", time.Time{}, errors.New("shard id must be >= 0")
	}

	now := time.Now().UTC()
	expiresAt := now.Add(ttl)
	if err := s.db.WithContext(ctx).Exec(`
INSERT INTO compactor_leases (tenant_id, shard_id, owner_id, leased_at, expires_at)
VALUES (?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  owner_id = IF(owner_id = VALUES(owner_id) OR expires_at < VALUES(leased_at), VALUES(owner_id), owner_id),
  leased_at = IF(owner_id = VALUES(owner_id) OR expires_at < VALUES(leased_at), VALUES(leased_at), leased_at),
  expires_at = IF(owner_id = VALUES(owner_id) OR expires_at < VALUES(leased_at), VALUES(expires_at), expires_at)`,
		tenantID, shardID, ownerID, now, expiresAt,
	).Error; err != nil {
		observeWALMetrics("acquire_lease", "error", start, 0)
		return false, "", time.Time{}, fmt.Errorf("upsert shard lease: %w", err)
	}

	lease, err := s.loadLease(ctx, tenantID, shardID)
	if err != nil {
		observeWALMetrics("acquire_lease", "error", start, 0)
		return false, "", time.Time{}, err
	}

	held := lease.OwnerID == ownerID && lease.ExpiresAt.After(now)
	observeWALMetrics("acquire_lease", "success", start, 1)
	return held, lease.OwnerID, lease.ExpiresAt.UTC(), nil
}

func (s *WALStore) RenewLease(ctx context.Context, tenantID string, shardID int, ownerID string, ttl time.Duration) (bool, string, time.Time, error) {
	start := time.Now()
	if err := validateLeaseInput(tenantID, ownerID, ttl); err != nil {
		observeWALMetrics("renew_lease", "error", start, 0)
		return false, "", time.Time{}, err
	}
	if shardID < 0 {
		observeWALMetrics("renew_lease", "error", start, 0)
		return false, "", time.Time{}, errors.New("shard id must be >= 0")
	}

	now := time.Now().UTC()
	expiresAt := now.Add(ttl)
	result := s.db.WithContext(ctx).Exec(`
UPDATE compactor_leases
SET leased_at = ?, expires_at = ?
WHERE tenant_id = ?
  AND shard_id = ?
  AND owner_id = ?
  AND expires_at >= ?`,
		now, expiresAt, tenantID, shardID, ownerID, now,
	)
	if result.Error != nil {
		observeWALMetrics("renew_lease", "error", start, 0)
		return false, "", time.Time{}, fmt.Errorf("renew shard lease: %w", result.Error)
	}
	if result.RowsAffected > 0 {
		observeWALMetrics("renew_lease", "success", start, 1)
		return true, ownerID, expiresAt, nil
	}

	lease, err := s.loadLease(ctx, tenantID, shardID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			observeWALMetrics("renew_lease", "success", start, 0)
			return false, "", time.Time{}, nil
		}
		observeWALMetrics("renew_lease", "error", start, 0)
		return false, "", time.Time{}, err
	}

	held := lease.OwnerID == ownerID && lease.ExpiresAt.After(now)
	observeWALMetrics("renew_lease", "success", start, 1)
	return held, lease.OwnerID, lease.ExpiresAt.UTC(), nil
}

func (s *WALStore) loadLease(ctx context.Context, tenantID string, shardID int) (*CompactorLeaseModel, error) {
	var lease CompactorLeaseModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND shard_id = ?", tenantID, shardID).
		First(&lease).Error; err != nil {
		return nil, fmt.Errorf("load shard lease state: %w", err)
	}
	return &lease, nil
}

func validateShardWindow(shardWindowSeconds int, shardCount int) error {
	if shardWindowSeconds <= 0 {
		return errors.New("shard window seconds must be > 0")
	}
	if shardCount <= 0 {
		return errors.New("shard count must be > 0")
	}
	return nil
}

func validateLeaseInput(tenantID, ownerID string, ttl time.Duration) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(ownerID) == "" {
		return errors.New("owner id is required")
	}
	if ttl <= 0 {
		return errors.New("lease ttl must be > 0")
	}
	return nil
}
