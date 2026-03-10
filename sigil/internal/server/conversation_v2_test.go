package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
)

func TestConversationDetailV2Endpoint(t *testing.T) {
	conversationStore := &testConversationStore{
		items: []storage.Conversation{
			{
				TenantID:         "fake",
				ConversationID:   "conv-1",
				GenerationCount:  0,
				CreatedAt:        time.Date(2026, 3, 10, 10, 0, 0, 0, time.UTC),
				LastGenerationAt: time.Date(2026, 3, 10, 10, 0, 0, 0, time.UTC),
				UpdatedAt:        time.Date(2026, 3, 10, 10, 0, 0, 0, time.UTC),
			},
		},
	}

	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		ConversationStore: conversationStore,
		WALReader:         &testWALReader{},
		FeedbackStore:     feedback.NewMemoryStore(),
	})
	if err != nil {
		t.Fatalf("new query service: %v", err)
	}

	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterQueryRoutes(
		mux,
		querySvc,
		nil,
		nil,
		feedback.NewService(feedback.NewMemoryStore()),
		true,
		true,
		newTestModelCardService(t),
		nil,
		protected,
		nil,
	)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/conversations/conv-1", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"shared":{}`) {
		t.Fatalf("expected v2 shared payload in response, body=%s", resp.Body.String())
	}
}
