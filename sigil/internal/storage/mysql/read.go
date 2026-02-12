package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

var _ storage.WALReader = (*WALStore)(nil)

func (s *WALStore) GetByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("get_by_id", "error", start, 0)
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(generationID) == "" {
		observeWALMetrics("get_by_id", "error", start, 0)
		return nil, errors.New("generation id is required")
	}

	var row GenerationModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND generation_id = ?", tenantID, generationID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		observeWALMetrics("get_by_id", "not_found", start, 0)
		return nil, nil
	}
	if err != nil {
		observeWALMetrics("get_by_id", "error", start, 0)
		return nil, fmt.Errorf("query generation by id: %w", err)
	}

	generation, err := decodeGenerationPayload(row.Payload)
	if err != nil {
		observeWALMetrics("get_by_id", "error", start, 0)
		return nil, fmt.Errorf("decode generation payload: %w", err)
	}
	observeWALMetrics("get_by_id", "success", start, 1)
	return generation, nil
}

func (s *WALStore) GetByConversationID(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error) {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeWALMetrics("get_by_conversation", "error", start, 0)
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		observeWALMetrics("get_by_conversation", "error", start, 0)
		return nil, errors.New("conversation id is required")
	}

	var rows []GenerationModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
		Order("created_at ASC, id ASC").
		Find(&rows).Error; err != nil {
		observeWALMetrics("get_by_conversation", "error", start, 0)
		return nil, fmt.Errorf("query generations by conversation: %w", err)
	}

	generations := make([]*sigilv1.Generation, 0, len(rows))
	for _, row := range rows {
		generation, err := decodeGenerationPayload(row.Payload)
		if err != nil {
			observeWALMetrics("get_by_conversation", "error", start, len(generations))
			return nil, fmt.Errorf("decode generation payload %q: %w", row.GenerationID, err)
		}
		generations = append(generations, generation)
	}

	observeWALMetrics("get_by_conversation", "success", start, len(generations))
	return generations, nil
}

func decodeGenerationPayload(payload []byte) (*sigilv1.Generation, error) {
	var generation sigilv1.Generation
	if err := proto.Unmarshal(payload, &generation); err != nil {
		return nil, err
	}
	return &generation, nil
}
