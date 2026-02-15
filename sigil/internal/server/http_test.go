package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/internal/queryproxy"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestExportGenerationsHTTPParity(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	request := &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-http",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}}
	payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/generations:export", bytes.NewReader(payload))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d", http.StatusAccepted, resp.Code)
	}

	var response sigilv1.ExportGenerationsResponse
	if err := protojson.Unmarshal(resp.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected accepted result, got %q", response.Results[0].Error)
	}
	if response.Results[0].GenerationId != "gen-http" {
		t.Fatalf("expected generation id gen-http, got %q", response.Results[0].GenerationId)
	}
}

func TestExportGenerationsHTTPRejectsInvalid(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/generations:export", bytes.NewBufferString(`{"generations":[{"id":"gen-http-invalid","mode":"GENERATION_MODE_SYNC","model":{"name":"gpt-5"}}]}`))
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d", http.StatusAccepted, resp.Code)
	}

	var response sigilv1.ExportGenerationsResponse
	if err := protojson.Unmarshal(resp.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if response.Results[0].Accepted {
		t.Fatalf("expected rejected result")
	}
	if response.Results[0].Error != "generation.model.provider is required" {
		t.Fatalf("unexpected error: %q", response.Results[0].Error)
	}
}

func TestRecordsEndpointsAreRemoved(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), nil)

	for _, path := range []string{"/api/v1/records", "/api/v1/records/rec-1"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{}`))
		resp := httptest.NewRecorder()
		mux.ServeHTTP(resp, req)

		if resp.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for %s, got %d", path, resp.Code)
		}
	}
}

func TestProtectedRoutesRequireTenantHeaderWhenAuthEnabled(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}

	authorizedReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations", nil)
	authorizedReq.Header.Set("X-Scope-OrgID", "tenant-a")
	authorizedResp := httptest.NewRecorder()
	mux.ServeHTTP(authorizedResp, authorizedReq)
	if authorizedResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", authorizedResp.Code)
	}

	ratingReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/c-1/ratings", nil)
	ratingResp := httptest.NewRecorder()
	mux.ServeHTTP(ratingResp, ratingReq)
	if ratingResp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for protected ratings route, got %d", ratingResp.Code)
	}
}

func TestHealthRouteIsExemptFromTenantHeader(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
}

func TestModelCardsListAndLookup(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards", nil)
	listResp := httptest.NewRecorder()
	mux.ServeHTTP(listResp, listReq)
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp.Code)
	}
	if !strings.Contains(listResp.Body.String(), `"source_path":"snapshot_fallback"`) {
		t.Fatalf("expected snapshot fallback source path, body=%s", listResp.Body.String())
	}
	if !strings.Contains(listResp.Body.String(), `"model_key":"openrouter:test/model"`) {
		t.Fatalf("expected seeded model key in list response")
	}

	lookupReq := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards:lookup?model_key=openrouter:test/model", nil)
	lookupResp := httptest.NewRecorder()
	mux.ServeHTTP(lookupResp, lookupReq)
	if lookupResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", lookupResp.Code)
	}
	if !strings.Contains(lookupResp.Body.String(), `"model_key":"openrouter:test/model"`) {
		t.Fatalf("expected model key in lookup response")
	}
}

func TestModelCardsListSupportsRegexFilter(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	regexReq := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards?regex=^openrouter:test/model$", nil)
	regexResp := httptest.NewRecorder()
	mux.ServeHTTP(regexResp, regexReq)

	if regexResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", regexResp.Code)
	}
	if !strings.Contains(regexResp.Body.String(), `"model_key":"openrouter:test/model"`) {
		t.Fatalf("expected regex-matched model key in response body=%s", regexResp.Body.String())
	}
}

func TestModelCardsListRejectsInvalidRegex(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	regexReq := httptest.NewRequest(http.MethodGet, "/api/v1/model-cards?regex=[", nil)
	regexResp := httptest.NewRecorder()
	mux.ServeHTTP(regexResp, regexReq)

	if regexResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", regexResp.Code)
	}
}

func TestModelCardsRefreshEndpoint(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	svc := newTestModelCardService(t)
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, svc, protected)

	refreshReq := httptest.NewRequest(http.MethodPost, "/api/v1/model-cards:refresh", bytes.NewBufferString(`{"source":"openrouter"}`))
	refreshResp := httptest.NewRecorder()
	mux.ServeHTTP(refreshResp, refreshReq)
	if refreshResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", refreshResp.Code)
	}
	if !strings.Contains(refreshResp.Body.String(), `"run_mode":"fallback"`) {
		t.Fatalf("expected fallback run mode, body=%s", refreshResp.Body.String())
	}
}

func TestConversationRatingsCreateAndList(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/conv-rating-1/ratings", bytes.NewBufferString(`{"rating_id":"rat-1","rating":"CONVERSATION_RATING_VALUE_BAD","comment":"wrong answer","metadata":{"channel":"assistant"}}`))
	createResp := httptest.NewRecorder()
	mux.ServeHTTP(createResp, createReq)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", createResp.Code, createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), `"rating_id":"rat-1"`) {
		t.Fatalf("expected rating id in response, body=%s", createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), `"has_bad_rating":true`) {
		t.Fatalf("expected has_bad_rating=true in response, body=%s", createResp.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-rating-1/ratings?limit=10", nil)
	listResp := httptest.NewRecorder()
	mux.ServeHTTP(listResp, listReq)
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp.Code)
	}
	if !strings.Contains(listResp.Body.String(), `"rating_id":"rat-1"`) {
		t.Fatalf("expected rating in list response, body=%s", listResp.Body.String())
	}
}

func TestConversationRatingsRejectIdempotencyConflict(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	firstReq := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/conv-rating-2/ratings", bytes.NewBufferString(`{"rating_id":"rat-conflict","rating":"CONVERSATION_RATING_VALUE_GOOD"}`))
	firstResp := httptest.NewRecorder()
	mux.ServeHTTP(firstResp, firstReq)
	if firstResp.Code != http.StatusOK {
		t.Fatalf("expected first write to succeed, got %d", firstResp.Code)
	}

	secondReq := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/conv-rating-2/ratings", bytes.NewBufferString(`{"rating_id":"rat-conflict","rating":"CONVERSATION_RATING_VALUE_BAD"}`))
	secondResp := httptest.NewRecorder()
	mux.ServeHTTP(secondResp, secondReq)
	if secondResp.Code != http.StatusConflict {
		t.Fatalf("expected conflict status, got %d body=%s", secondResp.Code, secondResp.Body.String())
	}
}

func TestConversationAnnotationsRequireOperatorHeaders(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	noOperatorReq := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/conv-ann-1/annotations", bytes.NewBufferString(`{"annotation_id":"ann-1","annotation_type":"NOTE","body":"triage note"}`))
	noOperatorResp := httptest.NewRecorder()
	mux.ServeHTTP(noOperatorResp, noOperatorReq)
	if noOperatorResp.Code != http.StatusBadRequest {
		t.Fatalf("expected bad request when operator headers are missing, got %d", noOperatorResp.Code)
	}

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/conv-ann-1/annotations", bytes.NewBufferString(`{"annotation_id":"ann-1","annotation_type":"NOTE","body":"triage note","tags":{"status":"needs_review"}}`))
	createReq.Header.Set(feedback.HeaderOperatorID, "operator-1")
	createReq.Header.Set(feedback.HeaderOperatorLogin, "alice")
	createReq.Header.Set(feedback.HeaderOperatorName, "Alice")
	createResp := httptest.NewRecorder()
	mux.ServeHTTP(createResp, createReq)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", createResp.Code, createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), `"operator_id":"operator-1"`) {
		t.Fatalf("expected operator id in response, body=%s", createResp.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-ann-1/annotations", nil)
	listResp := httptest.NewRecorder()
	mux.ServeHTTP(listResp, listReq)
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp.Code)
	}
	if !strings.Contains(listResp.Body.String(), `"annotation_id":"ann-1"`) {
		t.Fatalf("expected annotation in list response, body=%s", listResp.Body.String())
	}
}

func TestConversationFeedbackPaginationValidation(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(mux, query.NewService(), generationingest.NewService(generationingest.NewMemoryStore()), feedback.NewService(feedback.NewMemoryStore()), true, true, newTestModelCardService(t), protected)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-rating-3/ratings?cursor=abc", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid cursor, got %d", resp.Code)
	}
}

func TestConversationFeedbackRoutesCanBeDisabled(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		query.NewService(),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		false,
		false,
		newTestModelCardService(t),
		protected,
	)

	ratingsReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-disable/ratings", nil)
	ratingsResp := httptest.NewRecorder()
	mux.ServeHTTP(ratingsResp, ratingsReq)
	if ratingsResp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when ratings are disabled, got %d", ratingsResp.Code)
	}

	annotationsReq := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-disable/annotations", nil)
	annotationsResp := httptest.NewRecorder()
	mux.ServeHTTP(annotationsResp, annotationsReq)
	if annotationsResp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when annotations are disabled, got %d", annotationsResp.Code)
	}
}

func TestListConversationsSupportsFeedbackFilters(t *testing.T) {
	conversationStore := &testConversationStore{
		items: []storage.Conversation{
			{
				TenantID:         "fake",
				ConversationID:   "conv-1",
				LastGenerationAt: time.Date(2026, 2, 13, 12, 0, 0, 0, time.UTC),
				GenerationCount:  1,
				CreatedAt:        time.Date(2026, 2, 13, 11, 55, 0, 0, time.UTC),
				UpdatedAt:        time.Date(2026, 2, 13, 12, 0, 0, 0, time.UTC),
			},
			{
				TenantID:         "fake",
				ConversationID:   "conv-2",
				LastGenerationAt: time.Date(2026, 2, 13, 12, 1, 0, 0, time.UTC),
				GenerationCount:  2,
				CreatedAt:        time.Date(2026, 2, 13, 11, 56, 0, 0, time.UTC),
				UpdatedAt:        time.Date(2026, 2, 13, 12, 1, 0, 0, time.UTC),
			},
		},
	}

	feedbackStore := feedback.NewMemoryStore()
	if _, _, err := feedbackStore.CreateConversationRating(context.Background(), "fake", "conv-1", feedback.CreateConversationRatingInput{
		RatingID: "rat-1",
		Rating:   feedback.RatingValueBad,
	}); err != nil {
		t.Fatalf("create bad rating: %v", err)
	}
	if _, _, err := feedbackStore.CreateConversationAnnotation(context.Background(), "fake", "conv-2", feedback.OperatorIdentity{
		OperatorID: "operator-1",
	}, feedback.CreateConversationAnnotationInput{
		AnnotationID:   "ann-1",
		AnnotationType: feedback.AnnotationTypeNote,
	}); err != nil {
		t.Fatalf("create annotation: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		query.NewServiceWithStores(conversationStore, feedbackStore),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedbackStore),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	badResp := httptest.NewRecorder()
	mux.ServeHTTP(badResp, httptest.NewRequest(http.MethodGet, "/api/v1/conversations?has_bad_rating=true", nil))
	if badResp.Code != http.StatusOK {
		t.Fatalf("expected 200 for has_bad_rating filter, got %d body=%s", badResp.Code, badResp.Body.String())
	}
	var badPayload struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(badResp.Body.Bytes(), &badPayload); err != nil {
		t.Fatalf("decode has_bad_rating payload: %v", err)
	}
	if len(badPayload.Items) != 1 || badPayload.Items[0].ID != "conv-1" {
		t.Fatalf("unexpected has_bad_rating payload: %s", badResp.Body.String())
	}

	annotationResp := httptest.NewRecorder()
	mux.ServeHTTP(annotationResp, httptest.NewRequest(http.MethodGet, "/api/v1/conversations?has_annotations=true", nil))
	if annotationResp.Code != http.StatusOK {
		t.Fatalf("expected 200 for has_annotations filter, got %d body=%s", annotationResp.Code, annotationResp.Body.String())
	}
	var annotationPayload struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(annotationResp.Body.Bytes(), &annotationPayload); err != nil {
		t.Fatalf("decode has_annotations payload: %v", err)
	}
	if len(annotationPayload.Items) != 1 || annotationPayload.Items[0].ID != "conv-2" {
		t.Fatalf("unexpected has_annotations payload: %s", annotationResp.Body.String())
	}
}

func TestListConversationsRejectsInvalidFeedbackFilters(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		query.NewService(),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations?has_bad_rating=maybe", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid has_bad_rating filter, got %d", resp.Code)
	}
}

func TestListConversationsReturnsEmptyItemsArray(t *testing.T) {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutes(
		mux,
		query.NewServiceWithStores(&testConversationStore{}, feedback.NewMemoryStore()),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"items":[]`) {
		t.Fatalf("expected items to be encoded as empty array, body=%s", resp.Body.String())
	}
}

func TestQueryProxyPassThroughAndTenantHeaderWhenAuthDisabled(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/prom-prefix/api/v1/query_range" {
			http.Error(w, "unexpected path", http.StatusBadRequest)
			return
		}
		if req.URL.RawQuery != "query=up&step=15" {
			http.Error(w, "unexpected query", http.StatusBadRequest)
			return
		}
		if got := req.Header.Get("X-Scope-OrgID"); got != "fake" {
			http.Error(w, "missing fake tenant header", http.StatusUnauthorized)
			return
		}
		if got := req.Header.Get("Authorization"); got != "" {
			http.Error(w, "authorization should not be forwarded", http.StatusBadRequest)
			return
		}
		w.Header().Set("X-Upstream", "ok")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	defer upstream.Close()

	proxy, err := queryproxy.New(queryproxy.Config{
		PrometheusBaseURL: upstream.URL + "/prom-prefix",
		TempoBaseURL:      upstream.URL + "/tempo-prefix",
		Timeout:           time.Second,
	})
	if err != nil {
		t.Fatalf("new query proxy: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutesWithQueryProxy(
		mux,
		query.NewService(),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
		proxy,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/proxy/prometheus/api/v1/query_range?query=up&step=15", nil)
	req.Header.Set("Authorization", "Bearer token")
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusAccepted {
		t.Fatalf("expected %d, got %d body=%s", http.StatusAccepted, resp.Code, resp.Body.String())
	}
	if body := strings.TrimSpace(resp.Body.String()); body != `{"status":"success"}` {
		t.Fatalf("unexpected response body: %s", body)
	}
	if got := resp.Header().Get("X-Upstream"); got != "ok" {
		t.Fatalf("expected X-Upstream header, got %q", got)
	}
}

func TestQueryProxyRequiresTenantWhenAuthEnabled(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if got := req.Header.Get("X-Scope-OrgID"); got != "tenant-a" {
			http.Error(w, "missing tenant header", http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	proxy, err := queryproxy.New(queryproxy.Config{
		PrometheusBaseURL: upstream.URL,
		TempoBaseURL:      upstream.URL,
		Timeout:           time.Second,
	})
	if err != nil {
		t.Fatalf("new query proxy: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	RegisterRoutesWithQueryProxy(
		mux,
		query.NewService(),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
		proxy,
	)

	unauthorizedReq := httptest.NewRequest(http.MethodGet, "/api/v1/proxy/prometheus/api/v1/query?query=up", nil)
	unauthorizedResp := httptest.NewRecorder()
	mux.ServeHTTP(unauthorizedResp, unauthorizedReq)
	if unauthorizedResp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without tenant header, got %d", unauthorizedResp.Code)
	}

	authorizedReq := httptest.NewRequest(http.MethodGet, "/api/v1/proxy/prometheus/api/v1/query?query=up", nil)
	authorizedReq.Header.Set("X-Scope-OrgID", "tenant-a")
	authorizedResp := httptest.NewRecorder()
	mux.ServeHTTP(authorizedResp, authorizedReq)
	if authorizedResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", authorizedResp.Code, authorizedResp.Body.String())
	}
}

func TestQueryProxyRejectsDisallowedPathsAndMethods(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	proxy, err := queryproxy.New(queryproxy.Config{
		PrometheusBaseURL: upstream.URL,
		TempoBaseURL:      upstream.URL,
		Timeout:           time.Second,
	})
	if err != nil {
		t.Fatalf("new query proxy: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutesWithQueryProxy(
		mux,
		query.NewService(),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
		proxy,
	)

	notAllowedReq := httptest.NewRequest(http.MethodGet, "/api/v1/proxy/prometheus/api/v1/alerts", nil)
	notAllowedResp := httptest.NewRecorder()
	mux.ServeHTTP(notAllowedResp, notAllowedReq)
	if notAllowedResp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for non-allowlisted path, got %d", notAllowedResp.Code)
	}

	badMethodReq := httptest.NewRequest(http.MethodPost, "/api/v1/proxy/tempo/api/search", nil)
	badMethodResp := httptest.NewRecorder()
	mux.ServeHTTP(badMethodResp, badMethodReq)
	if badMethodResp.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for method mismatch, got %d", badMethodResp.Code)
	}
}

func TestQueryProxyReturnsBadGatewayWhenUpstreamUnavailable(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := listener.Addr().String()
	_ = listener.Close()

	proxy, err := queryproxy.New(queryproxy.Config{
		PrometheusBaseURL: "http://" + addr,
		TempoBaseURL:      "http://" + addr,
		Timeout:           200 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("new query proxy: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterRoutesWithQueryProxy(
		mux,
		query.NewService(),
		generationingest.NewService(generationingest.NewMemoryStore()),
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		protected,
		proxy,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/proxy/prometheus/api/v1/query?query=up", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 when upstream is unavailable, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func newTestModelCardService(t *testing.T) *modelcards.Service {
	t.Helper()

	ctx := context.Background()
	store := modelcards.NewMemoryStore()
	if err := store.AutoMigrate(ctx); err != nil {
		t.Fatalf("auto migrate memory store: %v", err)
	}

	now := time.Now().UTC()
	contextLength := 128000
	card := modelcards.Card{
		ModelKey:      "openrouter:test/model",
		Source:        modelcards.SourceOpenRouter,
		SourceModelID: "test/model",
		Name:          "Test Model",
		Provider:      "test",
		ContextLength: &contextLength,
		Pricing: modelcards.Pricing{
			PromptUSDPerToken:     float64Ptr(0),
			CompletionUSDPerToken: float64Ptr(0),
		},
		IsFree:      true,
		FirstSeenAt: now,
		LastSeenAt:  now,
		RefreshedAt: now,
	}
	snapshot := modelcards.SnapshotFromCards(modelcards.SourceOpenRouter, now, []modelcards.Card{card})

	return modelcards.NewService(
		store,
		modelcards.NewStaticErrorSource(errors.New("live source disabled in tests")),
		&snapshot,
		modelcards.Config{
			SyncInterval:  30 * time.Minute,
			LeaseTTL:      2 * time.Minute,
			SourceTimeout: 2 * time.Second,
			StaleSoft:     2 * time.Hour,
			StaleHard:     24 * time.Hour,
			BootstrapMode: modelcards.BootstrapModeSnapshotFirst,
			OwnerID:       "test-owner",
		},
		nil,
	)
}

func float64Ptr(value float64) *float64 {
	v := value
	return &v
}

type testConversationStore struct {
	items []storage.Conversation
}

func (s *testConversationStore) ListConversations(_ context.Context, tenantID string) ([]storage.Conversation, error) {
	out := make([]storage.Conversation, 0, len(s.items))
	for _, item := range s.items {
		if item.TenantID != tenantID {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *testConversationStore) GetConversation(_ context.Context, tenantID, conversationID string) (*storage.Conversation, error) {
	for _, item := range s.items {
		if item.TenantID != tenantID || item.ConversationID != conversationID {
			continue
		}
		copied := item
		return &copied, nil
	}
	return nil, nil
}
