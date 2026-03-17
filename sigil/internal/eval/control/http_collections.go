package control

import (
	"fmt"
	"net/http"
	"strings"
)

// RegisterCollectionRoutes registers HTTP routes for collection CRUD and membership.
func RegisterCollectionRoutes(
	mux *http.ServeMux,
	svc *CollectionService,
	protectedMiddleware func(http.Handler) http.Handler,
) {
	if mux == nil || svc == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("/api/v1/eval/collections", protectedMiddleware(http.HandlerFunc(svc.handleCollections)))
	mux.Handle("/api/v1/eval/collections/", protectedMiddleware(http.HandlerFunc(svc.handleCollectionRoutes)))
}

func (s *CollectionService) handleCollections(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	switch req.Method {
	case http.MethodGet:
		s.handleListCollections(w, req, tenantID)
	case http.MethodPost:
		s.handleCreateCollection(w, req, tenantID)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *CollectionService) handleCollectionRoutes(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	// Parse: /api/v1/eval/collections/{collection_id}[/members[/{saved_id}]]
	trimmed := strings.TrimPrefix(req.URL.Path, "/api/v1/eval/collections/")
	if trimmed == "" {
		http.Error(w, "invalid collection path", http.StatusBadRequest)
		return
	}

	parts := strings.SplitN(trimmed, "/", 3)

	switch len(parts) {
	case 1:
		// /api/v1/eval/collections/{collection_id}
		collectionID := parts[0]
		switch req.Method {
		case http.MethodGet:
			s.handleGetCollection(w, req, tenantID, collectionID)
		case http.MethodPatch:
			s.handleUpdateCollection(w, req, tenantID, collectionID)
		case http.MethodDelete:
			s.handleDeleteCollection(w, req, tenantID, collectionID)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	case 2:
		// /api/v1/eval/collections/{collection_id}/members
		collectionID := parts[0]
		if parts[1] != "members" {
			http.Error(w, "invalid collection path", http.StatusBadRequest)
			return
		}
		switch req.Method {
		case http.MethodGet:
			s.handleListMembers(w, req, tenantID, collectionID)
		case http.MethodPost:
			s.handleAddMembers(w, req, tenantID, collectionID)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	case 3:
		// /api/v1/eval/collections/{collection_id}/members/{saved_id}
		collectionID := parts[0]
		if parts[1] != "members" {
			http.Error(w, "invalid collection path", http.StatusBadRequest)
			return
		}
		savedID := parts[2]
		if savedID == "" {
			http.Error(w, "invalid collection path", http.StatusBadRequest)
			return
		}
		switch req.Method {
		case http.MethodDelete:
			s.handleRemoveMember(w, req, tenantID, collectionID, savedID)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	default:
		http.Error(w, "invalid collection path", http.StatusBadRequest)
	}
}

func (s *CollectionService) handleCreateCollection(w http.ResponseWriter, req *http.Request, tenantID string) {
	actorID, ok := actorIDFromRequest(w, req)
	if !ok {
		return
	}
	var body CreateCollectionRequest
	if err := decodeJSONBody(req, &body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	body.CreatedBy = actorID
	created, err := s.CreateCollection(req.Context(), tenantID, body)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, created)
}

func (s *CollectionService) handleListCollections(w http.ResponseWriter, req *http.Request, tenantID string) {
	limit, cursor, err := parseStringCursorPagination(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	items, nextCursor, err := s.ListCollections(req.Context(), tenantID, limit, cursor)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":       items,
		"next_cursor": nextCursor,
	})
}

func (s *CollectionService) handleGetCollection(w http.ResponseWriter, req *http.Request, tenantID, collectionID string) {
	c, err := s.GetCollection(req.Context(), tenantID, collectionID)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *CollectionService) handleUpdateCollection(w http.ResponseWriter, req *http.Request, tenantID, collectionID string) {
	actorID, ok := actorIDFromRequest(w, req)
	if !ok {
		return
	}
	var body UpdateCollectionRequest
	if err := decodeJSONBody(req, &body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	body.UpdatedBy = actorID
	if err := s.UpdateCollection(req.Context(), tenantID, collectionID, body); err != nil {
		writeControlWriteError(w, err)
		return
	}
	updated, err := s.GetCollection(req.Context(), tenantID, collectionID)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *CollectionService) handleDeleteCollection(w http.ResponseWriter, req *http.Request, tenantID, collectionID string) {
	if err := s.DeleteCollection(req.Context(), tenantID, collectionID); err != nil {
		writeControlWriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *CollectionService) handleAddMembers(w http.ResponseWriter, req *http.Request, tenantID, collectionID string) {
	actorID, ok := actorIDFromRequest(w, req)
	if !ok {
		return
	}
	var body AddMembersRequest
	if err := decodeJSONBody(req, &body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	body.AddedBy = actorID
	if err := s.AddMembers(req.Context(), tenantID, collectionID, body); err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *CollectionService) handleListMembers(w http.ResponseWriter, req *http.Request, tenantID, collectionID string) {
	limit, cursor, err := parseStringCursorPagination(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	items, nextCursor, err := s.ListMembers(req.Context(), tenantID, collectionID, limit, cursor)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":       items,
		"next_cursor": nextCursor,
	})
}

func (s *CollectionService) handleRemoveMember(w http.ResponseWriter, req *http.Request, tenantID, collectionID, savedID string) {
	if err := s.RemoveMember(req.Context(), tenantID, collectionID, savedID); err != nil {
		writeControlWriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// parseStringCursorPagination extracts limit and string cursor from query params.
func parseStringCursorPagination(req *http.Request) (int, string, error) {
	limit := 50
	if v := req.URL.Query().Get("limit"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n > 0 {
			limit = n
		}
	}
	cursor := req.URL.Query().Get("cursor")
	return limit, cursor, nil
}
