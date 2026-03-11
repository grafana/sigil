package control

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
)

func newCollectionMux(t *testing.T) (*http.ServeMux, *CollectionService) {
	t.Helper()
	store := newMockCollectionStore()
	scStore := newMockSavedConversationStore()
	svc := NewCollectionService(store, scStore)
	mux := http.NewServeMux()
	RegisterCollectionRoutes(mux, svc, tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"}))
	return mux, svc
}

func TestHTTPCollectionsCRUD(t *testing.T) {
	mux, _ := newCollectionMux(t)

	// Create
	body, _ := json.Marshal(CreateCollectionRequest{
		Name:        "Test Collection",
		Description: "A test collection",
		CreatedBy:   "user-1",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/eval/collections", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var created evalpkg.Collection
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("create: failed to decode response: %v", err)
	}
	if created.CollectionID == "" {
		t.Fatal("create: expected non-empty collection_id")
	}
	if created.Name != "Test Collection" {
		t.Fatalf("create: expected name %q, got %q", "Test Collection", created.Name)
	}

	collectionID := created.CollectionID

	// List
	req = httptest.NewRequest(http.MethodGet, "/api/v1/eval/collections", nil)
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

	// Get
	req = httptest.NewRequest(http.MethodGet, "/api/v1/eval/collections/"+collectionID, nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Update
	newName := "Updated Name"
	updateBody, _ := json.Marshal(UpdateCollectionRequest{
		Name:      &newName,
		UpdatedBy: "user-2",
	})
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/eval/collections/"+collectionID, bytes.NewReader(updateBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("update: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var updated evalpkg.Collection
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatalf("update: failed to decode response: %v", err)
	}
	if updated.Name != "Updated Name" {
		t.Fatalf("update: expected name %q, got %q", "Updated Name", updated.Name)
	}

	// Delete
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/eval/collections/"+collectionID, nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete: expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Get after delete — 404
	req = httptest.NewRequest(http.MethodGet, "/api/v1/eval/collections/"+collectionID, nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("get after delete: expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHTTPCollectionsNilSafety(t *testing.T) {
	// RegisterCollectionRoutes with nil mux or svc should not panic.
	RegisterCollectionRoutes(nil, nil, nil)
	RegisterCollectionRoutes(http.NewServeMux(), nil, nil)
}
