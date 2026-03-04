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
		var body SaveConversationRequest
		if err := decodeJSONBody(req, &body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
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
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       items,
			"next_cursor": formatCursor(nextCursor),
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

	savedID, valid := pathID(req.URL.Path, "/api/v1/eval/saved-conversations/")
	if !valid {
		http.Error(w, "invalid saved conversation id", http.StatusBadRequest)
		return
	}

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

func (s *SavedConversationService) handleCreateManualConversation(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	var body CreateManualConversationRequest
	if err := decodeJSONBody(req, &body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	created, err := s.CreateManualConversation(req.Context(), tenantID, body)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, created)
}
