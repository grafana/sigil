package control

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/grafana/dskit/tenant"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func RegisterHTTPRoutes(mux *http.ServeMux, service *Service, protectedMiddleware func(http.Handler) http.Handler) {
	if mux == nil || service == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("/api/v1/eval/evaluators", protectedMiddleware(http.HandlerFunc(service.handleEvaluators)))
	mux.Handle("/api/v1/eval/evaluators/", protectedMiddleware(http.HandlerFunc(service.handleEvaluatorByID)))
	mux.Handle("/api/v1/eval/rules", protectedMiddleware(http.HandlerFunc(service.handleRules)))
	mux.Handle("/api/v1/eval/rules/", protectedMiddleware(http.HandlerFunc(service.handleRuleByID)))
	mux.Handle("/api/v1/eval/judge/providers", protectedMiddleware(http.HandlerFunc(service.handleJudgeProviders)))
	mux.Handle("/api/v1/eval/judge/models", protectedMiddleware(http.HandlerFunc(service.handleJudgeModels)))
}

func (s *Service) handleEvaluators(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	switch req.Method {
	case http.MethodPost:
		var evaluator evalpkg.EvaluatorDefinition
		if err := decodeJSONBody(req, &evaluator); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		created, err := s.CreateEvaluator(req.Context(), tenantID, evaluator)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, created)
	case http.MethodGet:
		limit, cursor, err := parsePagination(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		items, nextCursor, err := s.ListEvaluators(req.Context(), tenantID, limit, cursor)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
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

func (s *Service) handleEvaluatorByID(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	evaluatorID, valid := pathID(req.URL.Path, "/api/v1/eval/evaluators/")
	if !valid {
		http.Error(w, "invalid evaluator id", http.StatusBadRequest)
		return
	}

	switch req.Method {
	case http.MethodGet:
		evaluator, err := s.GetEvaluator(req.Context(), tenantID, evaluatorID)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if evaluator == nil {
			http.NotFound(w, req)
			return
		}
		writeJSON(w, http.StatusOK, evaluator)
	case http.MethodDelete:
		if err := s.DeleteEvaluator(req.Context(), tenantID, evaluatorID); err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Service) handleRules(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	switch req.Method {
	case http.MethodPost:
		var rule evalpkg.RuleDefinition
		if err := decodeJSONBody(req, &rule); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		created, err := s.CreateRule(req.Context(), tenantID, rule)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, created)
	case http.MethodGet:
		limit, cursor, err := parsePagination(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		items, nextCursor, err := s.ListRules(req.Context(), tenantID, limit, cursor)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
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

func (s *Service) handleRuleByID(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	ruleID, valid := pathID(req.URL.Path, "/api/v1/eval/rules/")
	if !valid {
		http.Error(w, "invalid rule id", http.StatusBadRequest)
		return
	}

	switch req.Method {
	case http.MethodGet:
		rule, err := s.GetRule(req.Context(), tenantID, ruleID)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if rule == nil {
			http.NotFound(w, req)
			return
		}
		writeJSON(w, http.StatusOK, rule)
	case http.MethodPatch:
		var patch struct {
			Enabled *bool `json:"enabled"`
		}
		if err := decodeJSONBody(req, &patch); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if patch.Enabled == nil {
			http.Error(w, "enabled field is required", http.StatusBadRequest)
			return
		}
		updated, err := s.UpdateRuleEnabled(req.Context(), tenantID, ruleID, *patch.Enabled)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if updated == nil {
			http.NotFound(w, req)
			return
		}
		writeJSON(w, http.StatusOK, updated)
	case http.MethodDelete:
		if err := s.DeleteRule(req.Context(), tenantID, ruleID); err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Service) handleJudgeProviders(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": s.ListJudgeProviders(req.Context())})
}

func (s *Service) handleJudgeModels(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	providerID := strings.TrimSpace(req.URL.Query().Get("provider"))
	models, err := s.ListJudgeModels(req.Context(), providerID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

func decodeJSONBody(req *http.Request, out any) error {
	if req.Body == nil {
		return errors.New("request body is required")
	}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		return errors.New("read request body")
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return errors.New("request body is required")
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return errors.New("invalid request body")
	}
	return nil
}

func parsePagination(req *http.Request) (int, uint64, error) {
	limit := 50
	if rawLimit := strings.TrimSpace(req.URL.Query().Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed <= 0 {
			return 0, 0, errors.New("invalid limit")
		}
		limit = parsed
	}
	if limit > 500 {
		limit = 500
	}

	cursor := uint64(0)
	if rawCursor := strings.TrimSpace(req.URL.Query().Get("cursor")); rawCursor != "" {
		parsed, err := strconv.ParseUint(rawCursor, 10, 64)
		if err != nil {
			return 0, 0, errors.New("invalid cursor")
		}
		cursor = parsed
	}
	return limit, cursor, nil
}

func formatCursor(cursor uint64) string {
	if cursor == 0 {
		return ""
	}
	return strconv.FormatUint(cursor, 10)
}

func pathID(path string, prefix string) (string, bool) {
	trimmed := strings.TrimPrefix(path, prefix)
	if trimmed == "" || strings.Contains(trimmed, "/") {
		return "", false
	}
	return trimmed, true
}

func tenantIDFromRequest(w http.ResponseWriter, req *http.Request) (string, bool) {
	tenantID, err := tenant.TenantID(req.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return "", false
	}
	return tenantID, true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
