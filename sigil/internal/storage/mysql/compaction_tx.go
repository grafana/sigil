package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
)

func (s *WALStore) ClaimBatch(
	ctx context.Context,
	tenantID string,
	ownerID string,
	shard storage.ShardPredicate,
	olderThan time.Time,
	limit int,
) (int, error) {
	start := time.Now()
	if err := validateClaimInput(tenantID, ownerID, shard); err != nil {
		observeWALMetrics("claim_batch", "error", start, 0)
		return 0, err
	}
	if limit <= 0 {
		observeWALMetrics("claim_batch", "success", start, 0)
		return 0, nil
	}

	now := time.Now().UTC()
	// Claim is a single short UPDATE so object-store I/O never extends DB lock time.
	result := s.db.WithContext(ctx).Exec(`
UPDATE generations
SET claimed_by = ?, claimed_at = ?
WHERE tenant_id = ?
  AND compacted = FALSE
  AND claimed_by IS NULL
  AND created_at <= ?
  AND (FLOOR(UNIX_TIMESTAMP(created_at) / ?) % ?) = ?
ORDER BY created_at ASC, id ASC
LIMIT ?`,
		ownerID,
		now,
		tenantID,
		olderThan.UTC(),
		shard.ShardWindowSeconds,
		shard.ShardCount,
		shard.ShardID,
		limit,
	)
	if result.Error != nil {
		observeWALMetrics("claim_batch", "error", start, 0)
		return 0, fmt.Errorf("claim compaction rows: %w", result.Error)
	}

	claimed := int(result.RowsAffected)
	observeWALMetrics("claim_batch", "success", start, claimed)
	return claimed, nil
}

func (s *WALStore) LoadClaimed(
	ctx context.Context,
	tenantID string,
	ownerID string,
	shard storage.ShardPredicate,
	limit int,
) ([]*sigilv1.Generation, []uint64, error) {
	start := time.Now()
	if err := validateClaimInput(tenantID, ownerID, shard); err != nil {
		observeWALMetrics("load_claimed", "error", start, 0)
		return nil, nil, err
	}
	if limit <= 0 {
		observeWALMetrics("load_claimed", "success", start, 0)
		return []*sigilv1.Generation{}, []uint64{}, nil
	}

	var rows []GenerationModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND claimed_by = ? AND compacted = FALSE", tenantID, ownerID).
		Where("(FLOOR(UNIX_TIMESTAMP(created_at) / ?) % ?) = ?", shard.ShardWindowSeconds, shard.ShardCount, shard.ShardID).
		Order("created_at ASC, id ASC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		observeWALMetrics("load_claimed", "error", start, 0)
		return nil, nil, fmt.Errorf("load claimed rows: %w", err)
	}

	generations := make([]*sigilv1.Generation, 0, len(rows))
	ids := make([]uint64, 0, len(rows))
	for _, row := range rows {
		generation, err := decodeGenerationPayload(row.Payload)
		if err != nil {
			observeWALMetrics("load_claimed", "error", start, len(generations))
			return nil, nil, fmt.Errorf("decode claimed generation %q: %w", row.GenerationID, err)
		}
		generations = append(generations, generation)
		ids = append(ids, row.ID)
	}

	observeWALMetrics("load_claimed", "success", start, len(generations))
	return generations, ids, nil
}

func (s *WALStore) FinalizeClaimed(ctx context.Context, tenantID string, ownerID string, ids []uint64) error {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("finalize_claimed", "error", start, 0)
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(ownerID) == "" {
		observeWALMetrics("finalize_claimed", "error", start, 0)
		return errors.New("owner id is required")
	}
	if len(ids) == 0 {
		observeWALMetrics("finalize_claimed", "success", start, 0)
		return nil
	}

	now := time.Now().UTC()
	result := s.db.WithContext(ctx).Model(&GenerationModel{}).
		Where("tenant_id = ? AND claimed_by = ? AND id IN ?", tenantID, ownerID, ids).
		Where("compacted = ?", false).
		Updates(map[string]any{
			"compacted":    true,
			"compacted_at": now,
			"claimed_by":   nil,
			"claimed_at":   nil,
		})
	if result.Error != nil {
		observeWALMetrics("finalize_claimed", "error", start, 0)
		return fmt.Errorf("finalize claimed rows: %w", result.Error)
	}

	observeWALMetrics("finalize_claimed", "success", start, int(result.RowsAffected))
	return nil
}

func (s *WALStore) ReleaseStaleClaims(ctx context.Context, claimTTL time.Duration) (int64, error) {
	start := time.Now()
	if claimTTL <= 0 {
		observeWALMetrics("release_stale_claims", "error", start, 0)
		return 0, errors.New("claim ttl must be > 0")
	}

	cutoff := time.Now().UTC().Add(-claimTTL)
	result := s.db.WithContext(ctx).Model(&GenerationModel{}).
		Where("compacted = FALSE").
		Where("claimed_by IS NOT NULL").
		Where("claimed_at IS NOT NULL").
		Where("claimed_at < ?", cutoff).
		Updates(map[string]any{
			"claimed_by": nil,
			"claimed_at": nil,
		})
	if result.Error != nil {
		observeWALMetrics("release_stale_claims", "error", start, 0)
		return 0, fmt.Errorf("release stale claims: %w", result.Error)
	}

	observeWALMetrics("release_stale_claims", "success", start, int(result.RowsAffected))
	return result.RowsAffected, nil
}

func validateClaimInput(tenantID string, ownerID string, shard storage.ShardPredicate) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(ownerID) == "" {
		return errors.New("owner id is required")
	}
	if shard.ShardWindowSeconds <= 0 {
		return errors.New("shard window seconds must be > 0")
	}
	if shard.ShardCount <= 0 {
		return errors.New("shard count must be > 0")
	}
	if shard.ShardID < 0 || shard.ShardID >= shard.ShardCount {
		return errors.New("shard id must be in [0, shard_count)")
	}
	return nil
}
