package query

import (
	"context"
	"errors"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
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
	scores    []evalpkg.GenerationScore
	latest    map[string]evalpkg.LatestScore
	latestErr error
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
