package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	evalcontrol "github.com/grafana/sigil/sigil/internal/eval/control"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

var _ evalcontrol.ManualConversationWriter = (*WALStore)(nil)
var _ evalcontrol.ManualConversationDeleter = (*WALStore)(nil)

// CreateManualConversation creates a conversation row and generation rows in a
// single transaction for user-authored test data. Each generation payload is
// protobuf-encoded with source=manual.
func (s *WALStore) CreateManualConversation(ctx context.Context, tenantID, conversationID string, generations []evalcontrol.ManualGeneration) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		return errors.New("conversation id is required")
	}
	if len(generations) == 0 {
		return errors.New("at least one generation is required")
	}

	now := time.Now()

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		convRow := ConversationModel{
			TenantID:         tenantID,
			ConversationID:   conversationID,
			GenerationCount:  len(generations),
			LastGenerationAt: now,
		}
		if err := tx.Create(&convRow).Error; err != nil {
			return fmt.Errorf("create conversation: %w", err)
		}

		for i, gen := range generations {
			pb := manualGenerationToProto(gen, conversationID, now)
			payload, err := proto.Marshal(pb)
			if err != nil {
				return fmt.Errorf("marshal generation[%d]: %w", i, err)
			}

			convID := conversationID
			genRow := GenerationModel{
				TenantID:         tenantID,
				GenerationID:     gen.GenerationID,
				ConversationID:   &convID,
				Payload:          payload,
				PayloadSizeBytes: len(payload),
				Source:           "manual",
				CreatedAt:        now,
			}
			if err := tx.Create(&genRow).Error; err != nil {
				return fmt.Errorf("create generation[%d]: %w", i, err)
			}
		}

		return nil
	})
}

// DeleteManualConversationData removes all generation rows and the conversation
// row for a manual conversation in a single transaction.
func (s *WALStore) DeleteManualConversationData(ctx context.Context, tenantID, conversationID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
			Delete(&GenerationModel{}).Error; err != nil {
			return fmt.Errorf("delete generations: %w", err)
		}
		if err := tx.Where("tenant_id = ? AND conversation_id = ?", tenantID, conversationID).
			Delete(&ConversationModel{}).Error; err != nil {
			return fmt.Errorf("delete conversation: %w", err)
		}
		return nil
	})
}

// manualGenerationToProto converts a ManualGeneration to a protobuf Generation message.
func manualGenerationToProto(gen evalcontrol.ManualGeneration, conversationID string, now time.Time) *sigilv1.Generation {
	pb := &sigilv1.Generation{
		Id:             gen.GenerationID,
		ConversationId: conversationID,
		OperationName:  gen.OperationName,
		Mode:           parseGenerationMode(gen.Mode),
		Model:          &sigilv1.ModelRef{Provider: gen.Model.Provider, Name: gen.Model.Name},
		Input:          toProtoMessages(gen.Input),
		Output:         toProtoMessages(gen.Output),
	}

	if gen.StartedAt != nil {
		pb.StartedAt = timestamppb.New(*gen.StartedAt)
	} else {
		pb.StartedAt = timestamppb.New(now)
	}

	if gen.CompletedAt != nil {
		pb.CompletedAt = timestamppb.New(*gen.CompletedAt)
	} else {
		pb.CompletedAt = timestamppb.New(now)
	}

	return pb
}

func parseGenerationMode(mode string) sigilv1.GenerationMode {
	switch strings.ToUpper(strings.TrimSpace(mode)) {
	case "SYNC":
		return sigilv1.GenerationMode_GENERATION_MODE_SYNC
	case "STREAM":
		return sigilv1.GenerationMode_GENERATION_MODE_STREAM
	default:
		return sigilv1.GenerationMode_GENERATION_MODE_UNSPECIFIED
	}
}

func toProtoMessages(msgs []evalcontrol.ManualMessage) []*sigilv1.Message {
	out := make([]*sigilv1.Message, 0, len(msgs))
	for _, msg := range msgs {
		out = append(out, &sigilv1.Message{
			Role:  parseMessageRole(msg.Role),
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: msg.Content}}},
		})
	}
	return out
}

func parseMessageRole(role string) sigilv1.MessageRole {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "user":
		return sigilv1.MessageRole_MESSAGE_ROLE_USER
	case "assistant":
		return sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT
	case "tool":
		return sigilv1.MessageRole_MESSAGE_ROLE_TOOL
	default:
		return sigilv1.MessageRole_MESSAGE_ROLE_UNSPECIFIED
	}
}
