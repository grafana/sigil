package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"google.golang.org/protobuf/types/known/timestamppb"
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

func TestConversationDetailFormatV2OnV1Endpoint(t *testing.T) {
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/conversations/conv-1?format=v2", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"shared":{}`) {
		t.Fatalf("expected v2 shared payload in response, body=%s", resp.Body.String())
	}
}

func TestConversationDetailV2EndpointSupportsPaginationWindow(t *testing.T) {
	base := time.Date(2026, 3, 10, 10, 0, 0, 0, time.UTC)
	conversationStore := &testConversationStore{
		items: []storage.Conversation{
			{
				TenantID:         "fake",
				ConversationID:   "conv-1",
				GenerationCount:  3,
				CreatedAt:        base,
				LastGenerationAt: base.Add(3 * time.Minute),
				UpdatedAt:        base.Add(3 * time.Minute),
			},
		},
	}

	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		ConversationStore: conversationStore,
		WALReader: &testWALReader{
			byConversation: map[string][]*sigilv1.Generation{
				"conv-1": {
					{Id: "gen-1", ConversationId: "conv-1", CompletedAt: timestamppb.New(base.Add(time.Minute))},
					{Id: "gen-2", ConversationId: "conv-1", CompletedAt: timestamppb.New(base.Add(2 * time.Minute))},
					{Id: "gen-3", ConversationId: "conv-1", CompletedAt: timestamppb.New(base.Add(3 * time.Minute))},
				},
			},
		},
		FeedbackStore: feedback.NewMemoryStore(),
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

	req := httptest.NewRequest(http.MethodGet, "/api/v2/conversations/conv-1?limit=2&cursor=1", nil)
	resp := httptest.NewRecorder()
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"has_more":false`) {
		t.Fatalf("expected final page has_more=false, body=%s", resp.Body.String())
	}
	if strings.Contains(resp.Body.String(), `"next_cursor"`) {
		t.Fatalf("expected final page to omit next_cursor, body=%s", resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), `"generation_id":"gen-1"`) || !strings.Contains(resp.Body.String(), `"generation_id":"gen-2"`) {
		t.Fatalf("expected paged generations gen-1/gen-2, body=%s", resp.Body.String())
	}
	if strings.Contains(resp.Body.String(), `"generation_id":"gen-3"`) {
		t.Fatalf("expected newest generation to be excluded by cursor offset, body=%s", resp.Body.String())
	}
}

func TestParseConversationDetailPageRequiresLimitWithCursor(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v2/conversations/conv-1?cursor=20", nil)

	_, err := parseConversationDetailPage(req)
	if err == nil || !strings.Contains(err.Error(), "limit is required") {
		t.Fatalf("expected validation error about limit, got %v", err)
	}
}

func TestWriteConversationDetailErrorMapsUnavailableToGatewayTimeout(t *testing.T) {
	resp := httptest.NewRecorder()

	writeConversationDetailError(resp, query.NewUnavailableError(context.DeadlineExceeded.Error()))

	if resp.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "deadline exceeded") {
		t.Fatalf("expected unavailable error message, body=%s", resp.Body.String())
	}
}
