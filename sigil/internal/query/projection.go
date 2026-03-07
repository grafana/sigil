package query

import (
	"context"
	"sort"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/pkg/searchcore"
)

func (s *Service) ListConversationProjectionPageForTenant(
	ctx context.Context,
	tenantID string,
	from time.Time,
	to time.Time,
	limit int,
	excludeConversationIDs []string,
) ([]ConversationBatchMetadata, bool, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return nil, false, NewValidationError("tenant id is required")
	}

	pageSize := limit
	if pageSize <= 0 {
		pageSize = searchcore.DefaultConversationSearchPageSize
	}

	if pageStore, ok := s.conversationStore.(projectionConversationPageStore); ok {
		rows, hasMore, err := pageStore.ListConversationProjectionPage(ctx, trimmedTenantID, storage.ConversationProjectionPageQuery{
			From:                   from.UTC(),
			To:                     to.UTC(),
			Limit:                  pageSize,
			ExcludeConversationIDs: searchcore.DedupeAndSortStrings(excludeConversationIDs),
		})
		if err != nil {
			return nil, false, err
		}
		items, err := s.toConversationBatchMetadataPage(ctx, trimmedTenantID, rows)
		return items, hasMore, err
	}

	rows, hasMore, err := s.listConversationProjectionPageFallback(ctx, trimmedTenantID, from, to, pageSize, excludeConversationIDs)
	if err != nil {
		return nil, false, err
	}
	items, _, err := s.ListConversationBatchMetadataForTenant(ctx, trimmedTenantID, rows)
	if err != nil {
		return nil, false, err
	}
	return items, hasMore, nil
}

func (s *Service) toConversationBatchMetadataPage(
	ctx context.Context,
	tenantID string,
	rows []storage.ConversationProjectionPageItem,
) ([]ConversationBatchMetadata, error) {
	if len(rows) == 0 {
		return []ConversationBatchMetadata{}, nil
	}

	conversationIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		conversationIDs = append(conversationIDs, row.Conversation.ConversationID)
	}

	evalSummaries := map[string]evalpkg.ConversationEvalSummary{}
	if s.evalSummaryStore != nil {
		summaries, err := s.evalSummaryStore.ListConversationEvalSummaries(ctx, tenantID, conversationIDs)
		if err != nil {
			return nil, err
		}
		evalSummaries = summaries
	}

	items := make([]ConversationBatchMetadata, 0, len(rows))
	for _, row := range rows {
		item := ConversationBatchMetadata{
			ConversationID:    row.Conversation.ConversationID,
			ConversationTitle: row.Conversation.ConversationTitle,
			UserID:            row.Conversation.UserID,
			GenerationCount:   row.Conversation.GenerationCount,
			FirstGenerationAt: row.Conversation.FirstGenerationAt.UTC(),
			LastGenerationAt:  row.Conversation.LastGenerationAt.UTC(),
			Models:            append([]string{}, row.Conversation.Models...),
			ModelProviders:    cloneStringMap(row.Conversation.ModelProviders),
			Agents:            append([]string{}, row.Conversation.Agents...),
			ErrorCount:        row.Conversation.ErrorCount,
			HasErrors:         row.Conversation.ErrorCount > 0,
			InputTokens:       row.Conversation.InputTokens,
			OutputTokens:      row.Conversation.OutputTokens,
			CacheReadTokens:   row.Conversation.CacheReadTokens,
			CacheWriteTokens:  row.Conversation.CacheWriteTokens,
			ReasoningTokens:   row.Conversation.ReasoningTokens,
			TotalTokens:       row.Conversation.TotalTokens,
			AnnotationCount:   row.AnnotationCount,
		}
		if row.RatingSummary != nil {
			copied := *row.RatingSummary
			item.RatingSummary = &copied
		}
		if summary, ok := evalSummaries[item.ConversationID]; ok {
			copied := summary
			item.EvalSummary = &copied
		} else if row.EvalSummary != nil {
			item.EvalSummary = &evalpkg.ConversationEvalSummary{
				TotalScores: row.EvalSummary.TotalScores,
				PassCount:   row.EvalSummary.PassCount,
				FailCount:   row.EvalSummary.FailCount,
			}
		}
		items = append(items, item)
	}

	return items, nil
}

func (s *Service) listConversationProjectionPageFallback(
	ctx context.Context,
	tenantID string,
	from time.Time,
	to time.Time,
	limit int,
	excludeConversationIDs []string,
) ([]string, bool, error) {
	if s.conversationStore == nil {
		return nil, false, nil
	}

	rows, err := s.conversationStore.ListConversations(ctx, tenantID)
	if err != nil {
		return nil, false, err
	}

	excluded := make(map[string]struct{}, len(excludeConversationIDs))
	for _, conversationID := range excludeConversationIDs {
		if trimmed := strings.TrimSpace(conversationID); trimmed != "" {
			excluded[trimmed] = struct{}{}
		}
	}

	filtered := make([]storage.Conversation, 0, len(rows))
	for _, row := range rows {
		firstGenerationAt := row.FirstGenerationAt.UTC()
		lastGenerationAt := row.LastGenerationAt.UTC()
		// This fallback only has conversation-level first/last bounds available.
		// The primary MySQL projection path uses in-window generation existence for
		// activity checks; this fallback keeps a coarse bound check when a store
		// does not implement projection paging directly.
		if lastGenerationAt.Before(from.UTC()) || firstGenerationAt.After(to.UTC()) {
			continue
		}
		if _, ok := excluded[row.ConversationID]; ok {
			continue
		}
		filtered = append(filtered, row)
	}

	sort.Slice(filtered, func(i, j int) bool {
		if !filtered[i].LastGenerationAt.Equal(filtered[j].LastGenerationAt) {
			return filtered[i].LastGenerationAt.After(filtered[j].LastGenerationAt)
		}
		if !filtered[i].UpdatedAt.Equal(filtered[j].UpdatedAt) {
			return filtered[i].UpdatedAt.After(filtered[j].UpdatedAt)
		}
		return filtered[i].ConversationID > filtered[j].ConversationID
	})

	if limit <= 0 || len(filtered) <= limit {
		ids := make([]string, 0, len(filtered))
		for _, row := range filtered {
			ids = append(ids, row.ConversationID)
		}
		return ids, false, nil
	}

	ids := make([]string, 0, limit)
	for _, row := range filtered[:limit] {
		ids = append(ids, row.ConversationID)
	}
	return ids, true, nil
}
