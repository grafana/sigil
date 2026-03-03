package query

import (
	"context"
	"errors"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/feedback"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
)

func TestGetGenerationDetailForTenantIncludesLatestScores(t *testing.T) {
	generation := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-4o"},
	}
	service, err := NewServiceWithDependencies(ServiceDependencies{
		WALReader: &scoreTestWALReader{byID: map[string]*sigilv1.Generation{"gen-1": generation}},
		ScoreStore: &scoreTestStore{
			latest: map[string]evalpkg.LatestScore{
				"helpfulness": {
					ScoreKey:         "helpfulness",
					ScoreType:        evalpkg.ScoreTypeNumber,
					Value:            evalpkg.NumberValue(0.91),
					EvaluatorID:      "sigil.helpfulness",
					EvaluatorVersion: "2026-02-17",
					CreatedAt:        time.Date(2026, 2, 17, 10, 0, 0, 0, time.UTC),
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	payload, found, err := service.GetGenerationDetailForTenant(context.Background(), "tenant-a", "gen-1")
	if err != nil {
		t.Fatalf("get generation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected generation to be found")
	}
	latestRaw, ok := payload["latest_scores"].(map[string]any)
	if !ok {
		t.Fatalf("expected latest_scores map in payload, got %#v", payload["latest_scores"])
	}
	helpfulnessRaw, ok := latestRaw["helpfulness"].(map[string]any)
	if !ok {
		t.Fatalf("expected helpfulness latest score entry, got %#v", latestRaw["helpfulness"])
	}
	valueRaw, ok := helpfulnessRaw["value"].(map[string]any)
	if !ok {
		t.Fatalf("expected value map, got %#v", helpfulnessRaw["value"])
	}
	numberValue, ok := valueRaw["number"].(float64)
	if !ok || numberValue != 0.91 {
		t.Fatalf("expected helpfulness value 0.91, got %#v", valueRaw)
	}
}

func TestGetGenerationDetailForTenantIgnoresLatestScoreErrors(t *testing.T) {
	generation := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-4o"},
	}
	service, err := NewServiceWithDependencies(ServiceDependencies{
		WALReader: &scoreTestWALReader{byID: map[string]*sigilv1.Generation{"gen-1": generation}},
		ScoreStore: &scoreTestStore{
			latestErr: errors.New("scores unavailable"),
		},
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	payload, found, err := service.GetGenerationDetailForTenant(context.Background(), "tenant-a", "gen-1")
	if err != nil {
		t.Fatalf("expected generation detail lookup to succeed despite score enrichment error: %v", err)
	}
	if !found {
		t.Fatalf("expected generation to be found")
	}
	if _, hasLatest := payload["latest_scores"]; hasLatest {
		t.Fatalf("expected latest_scores to be omitted when enrichment fails, got %#v", payload["latest_scores"])
	}
}

func TestListGenerationScoresForTenantPagination(t *testing.T) {
	service := NewService()
	service.scoreStore = &scoreTestStore{scores: []evalpkg.GenerationScore{
		{ScoreID: "sc-1", GenerationID: "gen-1", ScoreKey: "helpfulness", ScoreType: evalpkg.ScoreTypeNumber, Value: evalpkg.NumberValue(0.2), CreatedAt: time.Now().UTC()},
		{ScoreID: "sc-2", GenerationID: "gen-1", ScoreKey: "helpfulness", ScoreType: evalpkg.ScoreTypeNumber, Value: evalpkg.NumberValue(0.4), CreatedAt: time.Now().UTC()},
		{ScoreID: "sc-3", GenerationID: "gen-1", ScoreKey: "helpfulness", ScoreType: evalpkg.ScoreTypeNumber, Value: evalpkg.NumberValue(0.6), CreatedAt: time.Now().UTC()},
	}}

	items, nextCursor, err := service.ListGenerationScoresForTenant(context.Background(), "tenant-a", "gen-1", 2, 0)
	if err != nil {
		t.Fatalf("list generation scores page 1: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 score items, got %d", len(items))
	}
	if nextCursor == 0 {
		t.Fatalf("expected non-zero next cursor")
	}

	items, nextCursor, err = service.ListGenerationScoresForTenant(context.Background(), "tenant-a", "gen-1", 2, nextCursor)
	if err != nil {
		t.Fatalf("list generation scores page 2: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 score item, got %d", len(items))
	}
	if nextCursor != 0 {
		t.Fatalf("expected final cursor to be zero")
	}
}

func TestGetConversationDetailForTenantIncludesLatestScoresPerGeneration(t *testing.T) {
	base := time.Date(2026, 3, 2, 10, 0, 0, 0, time.UTC)
	gen1 := testGenerationPayload("gen-1", "conv-1", base.Add(time.Minute))
	gen2 := testGenerationPayload("gen-2", "conv-1", base.Add(2*time.Minute))

	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  2,
				CreatedAt:        base,
				LastGenerationAt: base.Add(2 * time.Minute),
				UpdatedAt:        base.Add(2 * time.Minute),
			},
		},
	}
	walReader := &stubWALReader{
		byConversation: map[string][]*sigilv1.Generation{
			"conv-1": {gen1, gen2},
		},
		byID: map[string]*sigilv1.Generation{
			"gen-1": gen1,
			"gen-2": gen2,
		},
	}

	store := &scoreTestStore{
		latestByConversation: map[string]map[string]evalpkg.LatestScore{
			"gen-1": {
				"helpfulness": {
					ScoreKey:         "helpfulness",
					ScoreType:        evalpkg.ScoreTypeNumber,
					Value:            evalpkg.NumberValue(0.8),
					EvaluatorID:      "sigil.helpfulness",
					EvaluatorVersion: "2026-02-17",
					CreatedAt:        base.Add(time.Minute),
				},
			},
			"gen-2": {
				"helpfulness": {
					ScoreKey:         "helpfulness",
					ScoreType:        evalpkg.ScoreTypeNumber,
					Value:            evalpkg.NumberValue(0.6),
					EvaluatorID:      "sigil.helpfulness",
					EvaluatorVersion: "2026-02-17",
					CreatedAt:        base.Add(2 * time.Minute),
				},
			},
		},
	}

	service := NewService()
	service.conversationStore = conversationStore
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)
	service.scoreStore = store

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("get conversation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation to be found")
	}
	if len(detail.Generations) != 2 {
		t.Fatalf("expected 2 generations, got %d", len(detail.Generations))
	}

	for _, gen := range detail.Generations {
		genID, _ := gen["generation_id"].(string)
		latestRaw, ok := gen["latest_scores"].(map[string]any)
		if !ok {
			t.Fatalf("expected latest_scores on generation %s, got %#v", genID, gen["latest_scores"])
		}
		helpRaw, ok := latestRaw["helpfulness"].(map[string]any)
		if !ok {
			t.Fatalf("expected helpfulness entry for %s, got %#v", genID, latestRaw)
		}
		valueRaw, ok := helpRaw["value"].(map[string]any)
		if !ok {
			t.Fatalf("expected value map for %s, got %#v", genID, helpRaw["value"])
		}
		if _, ok := valueRaw["number"].(float64); !ok {
			t.Fatalf("expected number value for %s, got %#v", genID, valueRaw)
		}
	}
}

func TestGetConversationDetailForTenantIgnoresConversationScoreErrors(t *testing.T) {
	base := time.Date(2026, 3, 2, 10, 0, 0, 0, time.UTC)
	gen1 := testGenerationPayload("gen-1", "conv-1", base.Add(time.Minute))

	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base,
				LastGenerationAt: base.Add(time.Minute),
				UpdatedAt:        base.Add(time.Minute),
			},
		},
	}
	walReader := &stubWALReader{
		byConversation: map[string][]*sigilv1.Generation{
			"conv-1": {gen1},
		},
		byID: map[string]*sigilv1.Generation{"gen-1": gen1},
	}

	service := NewService()
	service.conversationStore = conversationStore
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)
	service.scoreStore = &scoreTestStore{
		latestByConvErr: errors.New("score store unavailable"),
	}

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("expected soft-fail on score error, got: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation to be found")
	}
	if len(detail.Generations) != 1 {
		t.Fatalf("expected 1 generation, got %d", len(detail.Generations))
	}
	if _, hasScores := detail.Generations[0]["latest_scores"]; hasScores {
		t.Fatalf("expected latest_scores to be omitted on error")
	}
}

func TestGetConversationDetailForTenantNoScoresWhenScoreStoreNil(t *testing.T) {
	base := time.Date(2026, 3, 2, 10, 0, 0, 0, time.UTC)
	gen1 := testGenerationPayload("gen-1", "conv-1", base.Add(time.Minute))

	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base,
				LastGenerationAt: base.Add(time.Minute),
				UpdatedAt:        base.Add(time.Minute),
			},
		},
	}
	walReader := &stubWALReader{
		byConversation: map[string][]*sigilv1.Generation{
			"conv-1": {gen1},
		},
		byID: map[string]*sigilv1.Generation{"gen-1": gen1},
	}

	service := NewService()
	service.conversationStore = conversationStore
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)
	// scoreStore intentionally nil

	detail, found, err := service.GetConversationDetailForTenant(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("get conversation detail: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation to be found")
	}
	if _, hasScores := detail.Generations[0]["latest_scores"]; hasScores {
		t.Fatalf("expected no latest_scores when scoreStore is nil")
	}
}

func TestSearchConversationsForTenantIncludesEvalSummary(t *testing.T) {
	base := time.Date(2026, 3, 2, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  2,
				CreatedAt:        base.Add(-5 * time.Minute),
				LastGenerationAt: base.Add(-2 * time.Minute),
				UpdatedAt:        base.Add(-2 * time.Minute),
			},
		},
	}

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				newTempoTrace("trace-1", base.Add(-2*time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", ""),
			},
		}},
	}
	service.evalSummaryStore = &stubEvalSummaryStore{
		summaries: map[string]evalpkg.ConversationEvalSummary{
			"conv-1": {TotalScores: 5, PassCount: 4, FailCount: 1},
		},
	}

	response, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		PageSize: 20,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search conversations: %v", err)
	}
	if len(response.Conversations) != 1 {
		t.Fatalf("expected 1 conversation, got %d", len(response.Conversations))
	}

	item := response.Conversations[0]
	if item.EvalSummary == nil {
		t.Fatalf("expected eval_summary to be present")
	}
	if item.EvalSummary.TotalScores != 5 {
		t.Errorf("expected total_scores=5, got %d", item.EvalSummary.TotalScores)
	}
	if item.EvalSummary.PassCount != 4 {
		t.Errorf("expected pass_count=4, got %d", item.EvalSummary.PassCount)
	}
	if item.EvalSummary.FailCount != 1 {
		t.Errorf("expected fail_count=1, got %d", item.EvalSummary.FailCount)
	}
}

func TestSearchConversationsForTenantNoEvalSummaryWhenStoreNil(t *testing.T) {
	base := time.Date(2026, 3, 2, 12, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  1,
				CreatedAt:        base.Add(-5 * time.Minute),
				LastGenerationAt: base.Add(-2 * time.Minute),
				UpdatedAt:        base.Add(-2 * time.Minute),
			},
		},
	}

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.tempoClient = &stubTempoClient{
		searchResponses: []*TempoSearchResponse{{
			Traces: []TempoTrace{
				newTempoTrace("trace-1", base.Add(-2*time.Minute), "conv-1", "gen-1", "gpt-4o", "assistant", ""),
			},
		}},
	}
	// evalSummaryStore intentionally nil

	response, err := service.SearchConversationsForTenant(context.Background(), "tenant-a", ConversationSearchRequest{
		Filters:  `model = "gpt-4o"`,
		PageSize: 20,
		TimeRange: ConversationSearchTimeRange{
			From: base.Add(-time.Hour),
			To:   base,
		},
	})
	if err != nil {
		t.Fatalf("search conversations: %v", err)
	}
	if len(response.Conversations) != 1 {
		t.Fatalf("expected 1 conversation, got %d", len(response.Conversations))
	}
	if response.Conversations[0].EvalSummary != nil {
		t.Fatalf("expected nil eval_summary when store is nil, got %#v", response.Conversations[0].EvalSummary)
	}
}

func TestScoreToResponsePayloadIncludesSourceWhenOnlySourceIDPresent(t *testing.T) {
	payload := scoreToResponsePayload(evalpkg.GenerationScore{
		ScoreID:      "sc-1",
		GenerationID: "gen-1",
		ScoreKey:     "helpfulness",
		ScoreType:    evalpkg.ScoreTypeString,
		Value:        evalpkg.StringValue("good"),
		SourceID:     "trace-abc",
		CreatedAt:    time.Date(2026, 2, 18, 14, 0, 0, 0, time.UTC),
	})

	sourceRaw, ok := payload["source"]
	if !ok {
		t.Fatalf("expected source payload when source_id is present")
	}
	source, ok := sourceRaw.(map[string]any)
	if !ok {
		t.Fatalf("expected source map payload, got %#v", sourceRaw)
	}
	if id, ok := source["id"].(string); !ok || id != "trace-abc" {
		t.Fatalf("expected source.id trace-abc, got %#v", source["id"])
	}
	if kind, ok := source["kind"].(string); !ok || kind != "" {
		t.Fatalf("expected empty source.kind for source-id only payload, got %#v", source["kind"])
	}
}

type scoreTestWALReader struct {
	byID map[string]*sigilv1.Generation
}

func (s *scoreTestWALReader) GetByID(_ context.Context, _ string, generationID string) (*sigilv1.Generation, error) {
	if generation, ok := s.byID[generationID]; ok {
		return generation, nil
	}
	return nil, nil
}

func (s *scoreTestWALReader) GetByConversationID(_ context.Context, _ string, _ string) ([]*sigilv1.Generation, error) {
	return nil, nil
}

type scoreTestStore struct {
	scores               []evalpkg.GenerationScore
	latest               map[string]evalpkg.LatestScore
	latestErr            error
	latestByConversation map[string]map[string]evalpkg.LatestScore
	latestByConvErr      error
}

func (s *scoreTestStore) GetScoresByGeneration(_ context.Context, _ string, _ string, limit int, cursor uint64) ([]evalpkg.GenerationScore, uint64, error) {
	if limit <= 0 {
		return nil, 0, nil
	}
	start := int(cursor)
	if start >= len(s.scores) {
		return []evalpkg.GenerationScore{}, 0, nil
	}
	end := start + limit
	if end > len(s.scores) {
		end = len(s.scores)
	}
	nextCursor := uint64(0)
	if end < len(s.scores) {
		nextCursor = uint64(end)
	}
	return append([]evalpkg.GenerationScore(nil), s.scores[start:end]...), nextCursor, nil
}

func (s *scoreTestStore) GetLatestScoresByGeneration(_ context.Context, _ string, _ string) (map[string]evalpkg.LatestScore, error) {
	if s.latestErr != nil {
		return nil, s.latestErr
	}
	if s.latest == nil {
		return map[string]evalpkg.LatestScore{}, nil
	}
	copied := make(map[string]evalpkg.LatestScore, len(s.latest))
	for key, value := range s.latest {
		copied[key] = value
	}
	return copied, nil
}

func (s *scoreTestStore) GetLatestScoresByConversation(_ context.Context, _ string, _ string) (map[string]map[string]evalpkg.LatestScore, error) {
	if s.latestByConvErr != nil {
		return nil, s.latestByConvErr
	}
	if s.latestByConversation == nil {
		return map[string]map[string]evalpkg.LatestScore{}, nil
	}
	copied := make(map[string]map[string]evalpkg.LatestScore, len(s.latestByConversation))
	for genID, scores := range s.latestByConversation {
		inner := make(map[string]evalpkg.LatestScore, len(scores))
		for key, val := range scores {
			inner[key] = val
		}
		copied[genID] = inner
	}
	return copied, nil
}

type stubEvalSummaryStore struct {
	summaries map[string]evalpkg.ConversationEvalSummary
	err       error
}

func (s *stubEvalSummaryStore) ListConversationEvalSummaries(_ context.Context, _ string, conversationIDs []string) (map[string]evalpkg.ConversationEvalSummary, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.summaries == nil {
		return map[string]evalpkg.ConversationEvalSummary{}, nil
	}
	result := make(map[string]evalpkg.ConversationEvalSummary)
	for _, id := range conversationIDs {
		if summary, ok := s.summaries[id]; ok {
			result[id] = summary
		}
	}
	return result, nil
}
