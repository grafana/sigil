package control

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/sigil/sigil/internal/tenantauth"
)

func newSavedConversationMux(svc *SavedConversationService) *http.ServeMux {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterSavedConversationRoutes(mux, svc, protected)
	return mux
}

// withActor sets the identity headers required by actorIDFromRequest.
func withActor(req *http.Request, actor string) *http.Request {
	req.Header.Set(HeaderGrafanaUser, actor)
	req.Header.Set(HeaderSigilTrustedActor, "true")
	return req
}

func TestHTTPSavedConversationsRoundtrip(t *testing.T) {
	store := newMockSavedConversationStore()
	convLookup := newMockConversationLookup()
	convLookup.Add("fake", "conv-abc")

	svc := NewSavedConversationService(store, convLookup)
	mux := newSavedConversationMux(svc)

	// Create (bookmark)
	body, _ := json.Marshal(SaveConversationRequest{
		SavedID:        "sc-1",
		ConversationID: "conv-abc",
		Name:           "Test",
		SavedBy:        "operator",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/eval/saved-conversations", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	withActor(req, "operator@example.com")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// List
	req = httptest.NewRequest(http.MethodGet, "/api/v1/eval/saved-conversations", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var listResp struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("list: failed to decode response: %v", err)
	}
	if len(listResp.Items) != 1 {
		t.Fatalf("list: expected 1 item, got %d", len(listResp.Items))
	}

	// Get — verify saved_by comes from identity header, not client body
	req = httptest.NewRequest(http.MethodGet, "/api/v1/eval/saved-conversations/sc-1", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		SavedBy string `json:"saved_by"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("get: failed to decode response: %v", err)
	}
	if got.SavedBy != "operator@example.com" {
		t.Fatalf("get: expected saved_by %q, got %q", "operator@example.com", got.SavedBy)
	}

	// Delete
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/eval/saved-conversations/sc-1", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete: expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Get after delete — 404
	req = httptest.NewRequest(http.MethodGet, "/api/v1/eval/saved-conversations/sc-1", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("get after delete: expected 404, got %d", w.Code)
	}
}

func TestHTTPSavedConversationsManualCreate(t *testing.T) {
	store := newMockSavedConversationStore()
	convLookup := newMockConversationLookup()
	writer := newMockManualConversationWriter()
	deleter := newMockManualConversationDeleter()

	svc := NewSavedConversationService(store, convLookup, WithManualWriter(writer), WithManualDeleter(deleter))
	mux := newSavedConversationMux(svc)

	body, _ := json.Marshal(CreateManualConversationRequest{
		SavedID: "manual-1",
		Name:    "Manual Test",
		SavedBy: "user-1",
		Generations: []ManualGeneration{
			{
				GenerationID: "gen-1",
				Model:        ManualModelRef{Provider: "openai", Name: "gpt-4o-mini"},
				Input:        []ManualMessage{{Role: "user", Content: "Hello"}},
				Output:       []ManualMessage{{Role: "assistant", Content: "Hi there"}},
			},
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/eval/saved-conversations:manual", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	withActor(req, "user-1@example.com")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create manual: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if !writer.Called("fake", "conv_manual_manual-1") {
		t.Fatal("expected manual writer to be called")
	}
}

func TestHTTPSavedConversationsMethodNotAllowed(t *testing.T) {
	store := newMockSavedConversationStore()
	convLookup := newMockConversationLookup()
	svc := NewSavedConversationService(store, convLookup)
	mux := newSavedConversationMux(svc)

	// PATCH on base path
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/eval/saved-conversations", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("base PATCH: expected 405, got %d", w.Code)
	}

	// POST on by-ID path
	req = httptest.NewRequest(http.MethodPost, "/api/v1/eval/saved-conversations/sc-1", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("by-id POST: expected 405, got %d", w.Code)
	}
}

func TestHTTPSavedConversationsNilArgs(t *testing.T) {
	// RegisterSavedConversationRoutes with nil mux or svc should not panic.
	RegisterSavedConversationRoutes(nil, nil, nil)
	RegisterSavedConversationRoutes(http.NewServeMux(), nil, nil)
}
