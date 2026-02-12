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

var _ storage.WALCompactor = (*WALStore)(nil)
var _ storage.WALTruncator = (*WALStore)(nil)

func (s *WALStore) ClaimUncompacted(ctx context.Context, tenantID string, olderThan time.Time, limit int) ([]*sigilv1.Generation, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("claim_uncompacted", "error", start, 0)
		return nil, errors.New("tenant id is required")
	}
	if limit <= 0 {
		observeWALMetrics("claim_uncompacted", "success", start, 0)
		return []*sigilv1.Generation{}, nil
	}

	var rows []GenerationModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND compacted = ? AND created_at <= ?", tenantID, false, olderThan.UTC()).
		Order("created_at ASC, id ASC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		observeWALMetrics("claim_uncompacted", "error", start, 0)
		return nil, fmt.Errorf("claim uncompacted rows: %w", err)
	}

	generations := make([]*sigilv1.Generation, 0, len(rows))
	for _, row := range rows {
		generation, err := decodeGenerationPayload(row.Payload)
		if err != nil {
			observeWALMetrics("claim_uncompacted", "error", start, len(generations))
			return nil, fmt.Errorf("decode generation payload %q: %w", row.GenerationID, err)
		}
		generations = append(generations, generation)
	}

	observeWALMetrics("claim_uncompacted", "success", start, len(generations))
	return generations, nil
}

func (s *WALStore) MarkCompacted(ctx context.Context, tenantID string, generationIDs []string) error {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("mark_compacted", "error", start, 0)
		return errors.New("tenant id is required")
	}
	filteredIDs := nonEmptyStrings(generationIDs)
	if len(filteredIDs) == 0 {
		observeWALMetrics("mark_compacted", "success", start, 0)
		return nil
	}

	now := time.Now().UTC()
	result := s.db.WithContext(ctx).
		Model(&GenerationModel{}).
		Where("tenant_id = ? AND generation_id IN ?", tenantID, filteredIDs).
		Where("compacted = ?", false).
		Updates(map[string]any{
			"compacted":    true,
			"compacted_at": now,
		})
	if result.Error != nil {
		observeWALMetrics("mark_compacted", "error", start, 0)
		return fmt.Errorf("mark rows compacted: %w", result.Error)
	}

	observeWALMetrics("mark_compacted", "success", start, int(result.RowsAffected))
	return nil
}

func (s *WALStore) TruncateCompacted(ctx context.Context, tenantID string, olderThan time.Time, limit int) (int64, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("truncate_compacted", "error", start, 0)
		return 0, errors.New("tenant id is required")
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
ORDER BY compacted_at ASC, id ASC
LIMIT ?`, tenantID, olderThan.UTC(), limit)
	if result.Error != nil {
		observeWALMetrics("truncate_compacted", "error", start, 0)
		return 0, fmt.Errorf("truncate compacted rows: %w", result.Error)
	}

	observeWALMetrics("truncate_compacted", "success", start, int(result.RowsAffected))
	return result.RowsAffected, nil
}

func nonEmptyStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	filtered := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		cleaned := strings.TrimSpace(value)
		if cleaned == "" {
			continue
		}
		if _, exists := seen[cleaned]; exists {
			continue
		}
		seen[cleaned] = struct{}{}
		filtered = append(filtered, cleaned)
	}
	return filtered
}
