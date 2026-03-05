package control

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

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

func RegisterHTTPRoutes(mux *http.ServeMux, service *Service, templateService *TemplateService, testService *TestService, protectedMiddleware func(http.Handler) http.Handler) {
	if mux == nil || service == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	register := func(pattern string, endpoint string, handler http.Handler) {
		mux.Handle(pattern, instrumentControlHandler(endpoint, protectedMiddleware(captureMetricsContext(handler))))
	}

	register("/api/v1/eval/evaluators", "evaluators", http.HandlerFunc(service.handleEvaluators))
	register("/api/v1/eval/evaluators/", "evaluator_by_id", http.HandlerFunc(service.handleEvaluatorByID))
	register("/api/v1/eval/predefined/evaluators", "predefined_evaluators", http.HandlerFunc(service.handlePredefinedEvaluators))
	register("/api/v1/eval/predefined/evaluators/", "predefined_evaluator_by_id", http.HandlerFunc(service.handlePredefinedEvaluatorByID))
	register("/api/v1/eval/rules", "rules", http.HandlerFunc(service.handleRules))
	register("/api/v1/eval/rules/", "rule_by_id", http.HandlerFunc(service.handleRuleByID))
	register("POST /api/v1/eval/rules:preview", "rules_preview", http.HandlerFunc(service.handleRulesPreview))
	register("/api/v1/eval/judge/providers", "judge_providers", http.HandlerFunc(service.handleJudgeProviders))
	register("/api/v1/eval/judge/models", "judge_models", http.HandlerFunc(service.handleJudgeModels))

	if templateService != nil {
		register("/api/v1/eval/templates", "templates", http.HandlerFunc(templateService.handleTemplates))
		register("/api/v1/eval/templates/", "template_subpaths", http.HandlerFunc(templateService.routeTemplateSubpaths))
	}

	if testService != nil {
		register("POST /api/v1/eval:test", "eval_test", http.HandlerFunc(testService.handleEvalTest))
	}
}

func (s *TestService) handleEvalTest(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	var testReq EvalTestRequest
	if err := decodeJSONBody(req, &testReq); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(req.Context(), 30*time.Second)
	defer cancel()

	resp, err := s.RunTest(ctx, tenantID, testReq)
	if err != nil {
		if isValidationError(err) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if isNotFoundError(err) {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		if ctx.Err() != nil {
			http.Error(w, "evaluation timed out", http.StatusGatewayTimeout)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, resp)
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

	ruleID, valid := pathIDEscaped(req, "/api/v1/eval/rules/")
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
			Enabled      *bool             `json:"enabled"`
			Selector     *evalpkg.Selector `json:"selector"`
			Match        map[string]any    `json:"match"`
			SampleRate   *float64          `json:"sample_rate"`
			EvaluatorIDs []string          `json:"evaluator_ids"`
		}
		if err := decodeJSONBody(req, &patch); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if patch.Enabled == nil && patch.Selector == nil && patch.Match == nil && patch.SampleRate == nil && patch.EvaluatorIDs == nil {
			http.Error(w, "at least one field must be provided", http.StatusBadRequest)
			return
		}
		updated, err := s.UpdateRule(req.Context(), tenantID, ruleID, patch.Enabled, patch.Selector, patch.Match, patch.SampleRate, patch.EvaluatorIDs)
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

func (s *Service) handleRulesPreview(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var previewReq evalpkg.RulePreviewRequest
	if err := decodeJSONBody(req, &previewReq); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp, err := s.PreviewRule(req.Context(), tenantID, previewReq)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
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

// pathIDEscaped extracts a path segment ID from req, supporting URL-encoded
// characters (e.g. %2F for slashes in rule IDs). Uses RawPath when available.
func pathIDEscaped(req *http.Request, prefix string) (string, bool) {
	path := req.URL.RawPath
	if path == "" {
		path = req.URL.Path
	}
	trimmed := strings.TrimPrefix(path, prefix)
	if trimmed == "" {
		return "", false
	}
	// When using RawPath, trimmed may contain %2F (encoded slash) but no literal /.
	// When using Path only, trimmed must not contain / (ambiguous with subpaths).
	if path == req.URL.Path && strings.Contains(trimmed, "/") {
		return "", false
	}
	id, err := url.PathUnescape(trimmed)
	if err != nil || id == "" {
		return "", false
	}
	return id, true
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
