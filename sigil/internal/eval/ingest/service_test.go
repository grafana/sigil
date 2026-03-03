package ingest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestServiceExportScores(t *testing.T) {
	store := &ingestStoreStub{}
	lookup := &generationLookupStub{existing: map[string]bool{"gen-1": true}}
	service := NewService(store, lookup, false)

	response := service.Export(context.Background(), "tenant-a", ExportScoresRequest{
		Scores: []ScoreItem{{
			ScoreID:          "sc-1",
			GenerationID:     "gen-1",
			EvaluatorID:      "custom.eval",
			EvaluatorVersion: "v1",
			ScoreKey:         "helpfulness",
			Value:            ScoreValue{Number: floatPtr(0.7)},
		}},
	})
	if len(response.Results) != 1 {
		t.Fatalf("expected one result, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected score to be accepted, got error %q", response.Results[0].Error)
	}
}

func TestServiceExportScoresIdempotent(t *testing.T) {
	store := &ingestStoreStub{existingScoreIDs: map[string]struct{}{"tenant-a|sc-1": {}}}
	lookup := &generationLookupStub{existing: map[string]bool{"gen-1": true}}
	service := NewService(store, lookup, false)

	response := service.Export(context.Background(), "tenant-a", ExportScoresRequest{
		Scores: []ScoreItem{{
			ScoreID:          "sc-1",
			GenerationID:     "gen-1",
			EvaluatorID:      "custom.eval",
			EvaluatorVersion: "v1",
			ScoreKey:         "helpfulness",
			Value:            ScoreValue{Number: floatPtr(0.7)},
		}},
	})
	if len(response.Results) != 1 || !response.Results[0].Accepted {
		t.Fatalf("expected duplicate score_id to be accepted idempotently, got %#v", response.Results)
	}
}

func TestServiceExportScoresValidationAndPartialBatch(t *testing.T) {
	store := &ingestStoreStub{}
	lookup := &generationLookupStub{existing: map[string]bool{"gen-1": true}}
	service := NewService(store, lookup, false)

	response := service.Export(context.Background(), "tenant-a", ExportScoresRequest{
		Scores: []ScoreItem{
			{
				ScoreID:          "sc-valid",
				GenerationID:     "gen-1",
				EvaluatorID:      "custom.eval",
				EvaluatorVersion: "v1",
				ScoreKey:         "helpfulness",
				Value:            ScoreValue{Number: floatPtr(0.7)},
			},
			{
				ScoreID:          "sc-invalid",
				GenerationID:     "",
				EvaluatorID:      "custom.eval",
				EvaluatorVersion: "v1",
				ScoreKey:         "helpfulness",
				Value:            ScoreValue{Number: floatPtr(0.5)},
			},
		},
	})

	if len(response.Results) != 2 {
		t.Fatalf("expected two per-item results")
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected first score accepted")
	}
	if response.Results[1].Accepted {
		t.Fatalf("expected second score rejected")
	}
	if !strings.Contains(response.Results[1].Error, "generation_id") {
		t.Fatalf("expected generation_id validation error, got %q", response.Results[1].Error)
	}
}

func TestHTTPExportScores(t *testing.T) {
	store := &ingestStoreStub{}
	lookup := &generationLookupStub{existing: map[string]bool{"gen-1": true}}
	service := NewService(store, lookup, false)

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterHTTPRoutes(mux, service, protected)

	requestBody := `{"scores":[{"score_id":"sc-1","generation_id":"gen-1","evaluator_id":"custom.eval","evaluator_version":"v1","score_key":"helpfulness","value":{"number":0.9}}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/scores:export", strings.NewReader(requestBody))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusAccepted {
		t.Fatalf("expected 202 accepted, got %d body=%s", resp.Code, resp.Body.String())
	}
	var decoded ExportScoresResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(decoded.Results) != 1 || !decoded.Results[0].Accepted {
		t.Fatalf("expected accepted result, got %#v", decoded.Results)
	}
}

func TestServiceExportEmitsScoreIngestMetrics(t *testing.T) {
	store := &ingestStoreStub{}
	lookup := &generationLookupStub{existing: map[string]bool{"gen-1": true}}
	service := NewService(store, lookup, false)

	acceptedBefore := testutil.ToFloat64(scoreIngestItemsTotal.WithLabelValues("tenant-a", "accepted", "none", "http"))
	rejectedBefore := testutil.ToFloat64(scoreIngestItemsTotal.WithLabelValues("tenant-a", "rejected", "validation", "http"))

	response := service.Export(withTransport(context.Background(), "http"), "tenant-a", ExportScoresRequest{
		Scores: []ScoreItem{
			{
				ScoreID:          "sc-ok",
				GenerationID:     "gen-1",
				EvaluatorID:      "custom.eval",
				EvaluatorVersion: "v1",
				ScoreKey:         "helpfulness",
				Value:            ScoreValue{Number: floatPtr(0.7)},
			},
			{
				ScoreID:          "sc-bad",
				GenerationID:     "",
				EvaluatorID:      "custom.eval",
				EvaluatorVersion: "v1",
				ScoreKey:         "helpfulness",
				Value:            ScoreValue{Number: floatPtr(0.2)},
			},
		},
	})
	if len(response.Results) != 2 {
		t.Fatalf("expected two results, got %d", len(response.Results))
	}

	acceptedAfter := testutil.ToFloat64(scoreIngestItemsTotal.WithLabelValues("tenant-a", "accepted", "none", "http"))
	rejectedAfter := testutil.ToFloat64(scoreIngestItemsTotal.WithLabelValues("tenant-a", "rejected", "validation", "http"))

	if delta := acceptedAfter - acceptedBefore; delta != 1 {
		t.Fatalf("expected one accepted metric increment, got %v", delta)
	}
	if delta := rejectedAfter - rejectedBefore; delta != 1 {
		t.Fatalf("expected one rejected metric increment, got %v", delta)
	}
}

type ingestStoreStub struct {
	existingScoreIDs map[string]struct{}
}

func (s *ingestStoreStub) InsertScore(_ context.Context, score evalpkg.GenerationScore) (bool, error) {
	if s.existingScoreIDs == nil {
		s.existingScoreIDs = map[string]struct{}{}
	}
	key := score.TenantID + "|" + score.ScoreID
	if _, exists := s.existingScoreIDs[key]; exists {
		return false, nil
	}
	s.existingScoreIDs[key] = struct{}{}
	return true, nil
}

type generationLookupStub struct {
	existing map[string]bool
}

func (s *generationLookupStub) GetByID(_ context.Context, _ string, generationID string) (*sigilv1.Generation, error) {
	if s.existing[generationID] {
		return &sigilv1.Generation{Id: generationID}, nil
	}
	return nil, nil
}

func floatPtr(v float64) *float64 {
	value := v
	return &value
}
