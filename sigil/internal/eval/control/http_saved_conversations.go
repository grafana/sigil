package control

import (
	"net/http"
	"strings"
)

// RegisterSavedConversationRoutes registers HTTP routes for saved conversations.
// This is a separate function (not modifying RegisterHTTPRoutes) to avoid changing
// the existing function signature.
func RegisterSavedConversationRoutes(mux *http.ServeMux, svc *SavedConversationService, protectedMiddleware func(http.Handler) http.Handler) {
	if mux == nil || svc == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("/api/v1/eval/saved-conversations", protectedMiddleware(http.HandlerFunc(svc.handleSavedConversations)))
	mux.Handle("/api/v1/eval/saved-conversations/", protectedMiddleware(http.HandlerFunc(svc.handleSavedConversationByID)))
	mux.Handle("POST /api/v1/eval/saved-conversations:manual", protectedMiddleware(http.HandlerFunc(svc.handleCreateManualConversation)))
}

func (s *SavedConversationService) handleSavedConversations(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	switch req.Method {
	case http.MethodPost:
		actorID, ok := actorIDFromRequest(w, req)
		if !ok {
			return
		}
		var body SaveConversationRequest
		if err := decodeJSONBody(req, &body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		body.SavedBy = actorID
		created, err := s.SaveConversation(req.Context(), tenantID, body)
		if err != nil {
			writeControlWriteError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, created)
	case http.MethodGet:
		limit, cursor, err := parsePagination(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		source := strings.TrimSpace(req.URL.Query().Get("source"))
		items, nextCursor, err := s.ListSavedConversations(req.Context(), tenantID, source, limit, cursor)
		if err != nil {
			writeControlWriteError(w, err)
			return
		}
		totalCount, err := s.CountSavedConversations(req.Context(), tenantID, source)
		if err != nil {
			writeControlWriteError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       items,
			"next_cursor": formatCursor(nextCursor),
			"total_count": totalCount,
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *SavedConversationService) handleSavedConversationByID(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	rest := strings.TrimPrefix(req.URL.Path, "/api/v1/eval/saved-conversations/")

	// Handle {saved_id}/collections sub-path
	if strings.HasSuffix(rest, "/collections") {
		savedID := strings.TrimSuffix(rest, "/collections")
		if savedID == "" || strings.Contains(savedID, "/") {
			http.Error(w, "invalid saved conversation path", http.StatusBadRequest)
			return
		}
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		s.handleListCollectionsForSaved(w, req, tenantID, savedID)
		return
	}

	// Existing: {saved_id} only
	if rest == "" || strings.Contains(rest, "/") {
		http.Error(w, "invalid saved conversation id", http.StatusBadRequest)
		return
	}
	savedID := rest

	switch req.Method {
	case http.MethodGet:
		sc, err := s.GetSavedConversation(req.Context(), tenantID, savedID)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if sc == nil {
			http.NotFound(w, req)
			return
		}
		writeJSON(w, http.StatusOK, sc)
	case http.MethodDelete:
		if err := s.DeleteSavedConversation(req.Context(), tenantID, savedID); err != nil {
			writeControlWriteError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *SavedConversationService) handleListCollectionsForSaved(w http.ResponseWriter, req *http.Request, tenantID, savedID string) {
	if s.collectionLister == nil {
		http.Error(w, "collections not available", http.StatusServiceUnavailable)
		return
	}
	collections, err := s.collectionLister.ListCollectionsForSavedConversation(req.Context(), tenantID, savedID)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":       collections,
		"next_cursor": "",
	})
}

func (s *SavedConversationService) handleCreateManualConversation(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}
	actorID, ok := actorIDFromRequest(w, req)
	if !ok {
		return
	}

	var body CreateManualConversationRequest
	if err := decodeJSONBody(req, &body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	body.SavedBy = actorID
	created, err := s.CreateManualConversation(req.Context(), tenantID, body)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, created)
}
