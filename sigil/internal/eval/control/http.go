package control

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/grafana/dskit/tenant"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

type createRuleRequest struct {
	RuleID       string           `json:"rule_id"`
	Enabled      *bool            `json:"enabled,omitempty"`
	Selector     evalpkg.Selector `json:"selector,omitempty"`
	Match        map[string]any   `json:"match,omitempty"`
	SampleRate   *float64         `json:"sample_rate,omitempty"`
	EvaluatorIDs []string         `json:"evaluator_ids"`
}

func (r createRuleRequest) toRuleDefinition() evalpkg.RuleDefinition {
	enabled := true
	if r.Enabled != nil {
		enabled = *r.Enabled
	}
	sampleRate := defaultRuleSampleRate
	if r.SampleRate != nil {
		sampleRate = *r.SampleRate
	}
	return evalpkg.RuleDefinition{
		RuleID:       strings.TrimSpace(r.RuleID),
		Enabled:      enabled,
		Selector:     r.Selector,
		Match:        r.Match,
		SampleRate:   sampleRate,
		EvaluatorIDs: r.EvaluatorIDs,
	}
}

func RegisterHTTPRoutes(mux *http.ServeMux, service *Service, templateService *TemplateService, protectedMiddleware func(http.Handler) http.Handler) {
	if mux == nil || service == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("/api/v1/eval/evaluators", protectedMiddleware(http.HandlerFunc(service.handleEvaluators)))
	mux.Handle("/api/v1/eval/evaluators/", protectedMiddleware(http.HandlerFunc(service.handleEvaluatorByID)))
	mux.Handle("/api/v1/eval/predefined/evaluators", protectedMiddleware(http.HandlerFunc(service.handlePredefinedEvaluators)))
	mux.Handle("/api/v1/eval/predefined/evaluators/", protectedMiddleware(http.HandlerFunc(service.handlePredefinedEvaluatorByID)))
	mux.Handle("/api/v1/eval/rules", protectedMiddleware(http.HandlerFunc(service.handleRules)))
	mux.Handle("/api/v1/eval/rules/", protectedMiddleware(http.HandlerFunc(service.handleRuleByID)))
	mux.Handle("/api/v1/eval/judge/providers", protectedMiddleware(http.HandlerFunc(service.handleJudgeProviders)))
	mux.Handle("/api/v1/eval/judge/models", protectedMiddleware(http.HandlerFunc(service.handleJudgeModels)))

	if templateService != nil {
		mux.Handle("/api/v1/eval/templates", protectedMiddleware(http.HandlerFunc(templateService.handleTemplates)))
		mux.Handle("/api/v1/eval/templates/", protectedMiddleware(http.HandlerFunc(templateService.routeTemplateSubpaths)))
	}
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
			writeControlWriteError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Service) handlePredefinedEvaluators(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": s.ListPredefinedEvaluators(req.Context()),
	})
}

func (s *Service) handlePredefinedEvaluatorByID(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	templateID, action, valid := pathIDAction(req.URL.Path, "/api/v1/eval/predefined/evaluators/")
	if !valid || action != "fork" {
		http.Error(w, "invalid predefined evaluator path", http.StatusBadRequest)
		return
	}
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request ForkPredefinedEvaluatorRequest
	if err := decodeJSONBody(req, &request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	created, err := s.ForkPredefinedEvaluator(req.Context(), tenantID, templateID, request)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, created)
}

func (s *Service) handleRules(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	switch req.Method {
	case http.MethodPost:
		var createRequest createRuleRequest
		if err := decodeJSONBody(req, &createRequest); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		rule := createRequest.toRuleDefinition()
		created, err := s.CreateRule(req.Context(), tenantID, rule)
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
			writeControlWriteError(w, err)
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
	if _, ok := tenantIDFromRequest(w, req); !ok {
		return
	}

	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": s.ListJudgeProviders(req.Context())})
}

func (s *Service) handleJudgeModels(w http.ResponseWriter, req *http.Request) {
	if _, ok := tenantIDFromRequest(w, req); !ok {
		return
	}

	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	providerID := strings.TrimSpace(req.URL.Query().Get("provider"))
	models, err := s.ListJudgeModels(req.Context(), providerID)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

// maxRequestBodySize limits the size of request bodies to prevent OOM from
// malicious or oversized payloads. 1 MB is generous for JSON config payloads.
const maxRequestBodySize = 1 << 20

func decodeJSONBody(req *http.Request, out any) error {
	if req.Body == nil {
		return errors.New("request body is required")
	}
	reader := io.LimitReader(req.Body, maxRequestBodySize+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		return errors.New("failed to read request body")
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return errors.New("request body is required")
	}
	if len(data) > maxRequestBodySize {
		return errors.New("request body too large")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
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

func pathIDAction(path string, prefix string) (string, string, bool) {
	trimmed := strings.TrimPrefix(path, prefix)
	if trimmed == "" || strings.Contains(trimmed, "/") {
		return "", "", false
	}

	parts := strings.SplitN(trimmed, ":", 2)
	if len(parts) != 2 {
		return "", "", false
	}

	id := strings.TrimSpace(parts[0])
	action := strings.TrimSpace(parts[1])
	if id == "" || action == "" {
		return "", "", false
	}
	return id, action, true
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

func writeControlWriteError(w http.ResponseWriter, err error) {
	if isValidationError(err) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	http.Error(w, "internal server error", http.StatusInternalServerError)
}
