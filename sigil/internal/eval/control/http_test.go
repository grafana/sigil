package control

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/predefined"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestEvaluatorCRUDHTTP(t *testing.T) {
	mux, _, _ := newEvalHTTPEnv(t)

	createPayload := `{
		"evaluator_id":"custom.helpfulness",
		"version":"2026-02-17",
		"kind":"llm_judge",
		"config":{"provider":"openai","model":"gpt-4o-mini"},
		"output_keys":[{"key":"helpfulness","type":"number"}]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/evaluators", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create evaluator, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/evaluators", "")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200 list evaluators, got %d body=%s", listResp.Code, listResp.Body.String())
	}
	if !strings.Contains(listResp.Body.String(), `"custom.helpfulness"`) {
		t.Errorf("expected evaluator id in list response, body=%s", listResp.Body.String())
	}

	getResp := doRequest(mux, http.MethodGet, "/api/v1/eval/evaluators/custom.helpfulness", "")
	if getResp.Code != http.StatusOK {
		t.Fatalf("expected 200 get evaluator, got %d body=%s", getResp.Code, getResp.Body.String())
	}

	deleteResp := doRequest(mux, http.MethodDelete, "/api/v1/eval/evaluators/custom.helpfulness", "")
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("expected 204 delete evaluator, got %d body=%s", deleteResp.Code, deleteResp.Body.String())
	}
	deleteResp = doRequest(mux, http.MethodDelete, "/api/v1/eval/evaluators/custom.helpfulness", "")
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("expected idempotent 204 delete evaluator, got %d body=%s", deleteResp.Code, deleteResp.Body.String())
	}

	missingResp := doRequest(mux, http.MethodGet, "/api/v1/eval/evaluators/custom.helpfulness", "")
	if missingResp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d body=%s", missingResp.Code, missingResp.Body.String())
	}
}

func TestEvalControlMetricsByTenant(t *testing.T) {
	mux, _, _ := newEvalHTTPEnv(t)
	before := testutil.ToFloat64(evalControlRequestsTotal.WithLabelValues("fake", "evaluators", "GET", "2xx"))

	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/evaluators", "")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200 list evaluators, got %d body=%s", listResp.Code, listResp.Body.String())
	}

	after := testutil.ToFloat64(evalControlRequestsTotal.WithLabelValues("fake", "evaluators", "GET", "2xx"))
	if delta := after - before; delta != 1 {
		t.Fatalf("expected one metrics increment, got %v", delta)
	}
}

func TestEvalControlMetricsUnauthorizedUsesUnknownTenant(t *testing.T) {
	store := newMemoryControlStore()
	service := NewService(store, nil)
	mux := http.NewServeMux()
	RegisterHTTPRoutes(mux, service, nil, nil, nil)

	before := testutil.ToFloat64(evalControlRequestsTotal.WithLabelValues("unknown", "judge_providers", "GET", "4xx"))

	providersResp := doRequest(mux, http.MethodGet, "/api/v1/eval/judge/providers", "")
	if providersResp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 providers without tenant context, got %d body=%s", providersResp.Code, providersResp.Body.String())
	}

	after := testutil.ToFloat64(evalControlRequestsTotal.WithLabelValues("unknown", "judge_providers", "GET", "4xx"))
	if delta := after - before; delta != 1 {
		t.Fatalf("expected one metrics increment, got %v", delta)
	}
}

func TestEvalControlMetricsRecordedWhenAuthMiddlewareRejects(t *testing.T) {
	store := newMemoryControlStore()
	service := NewService(store, nil)
	mux := http.NewServeMux()
	rejectingAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		})
	}
	RegisterHTTPRoutes(mux, service, nil, nil, rejectingAuth)

	before := testutil.ToFloat64(evalControlRequestsTotal.WithLabelValues("unknown", "evaluators", "GET", "4xx"))

	resp := doRequest(mux, http.MethodGet, "/api/v1/eval/evaluators", "")
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", resp.Code, resp.Body.String())
	}

	after := testutil.ToFloat64(evalControlRequestsTotal.WithLabelValues("unknown", "evaluators", "GET", "4xx"))
	if delta := after - before; delta != 1 {
		t.Fatalf("expected one metrics increment for auth-rejected request, got %v", delta)
	}
}

func TestDecodeJSONBody_WhitespaceOnlyBodyReturnsRequiredError(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/eval/evaluators", bytes.NewBufferString(" \n\t "))

	var payload map[string]any
	err := decodeJSONBody(req, &payload)
	if err == nil {
		t.Fatal("expected error for whitespace-only body")
	}
	if err.Error() != "request body is required" {
		t.Fatalf("expected request body required error, got %q", err.Error())
	}
}

func TestDeleteEvaluatorRejectsEnabledRuleReferences(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "fake",
		EvaluatorID: "custom.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config:      map[string]any{"not_empty": true},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}
	if err := store.CreateRule(context.Background(), evalpkg.RuleDefinition{
		TenantID:     "fake",
		RuleID:       "rule-helpfulness",
		Enabled:      true,
		Selector:     evalpkg.SelectorUserVisibleTurn,
		Match:        map[string]any{},
		SampleRate:   1,
		EvaluatorIDs: []string{"custom.helpfulness"},
	}); err != nil {
		t.Fatalf("seed rule: %v", err)
	}

	service := NewService(store, nil)
	mux := newEvalMux(service)

	deleteResp := doRequest(mux, http.MethodDelete, "/api/v1/eval/evaluators/custom.helpfulness", "")
	if deleteResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 delete referenced evaluator, got %d body=%s", deleteResp.Code, deleteResp.Body.String())
	}
	if !strings.Contains(deleteResp.Body.String(), `referenced by enabled rules`) {
		t.Errorf("expected referenced-rule validation error, got body=%s", deleteResp.Body.String())
	}
}

func TestCreateEvaluatorNormalizesIdentifiersWithWhitespace(t *testing.T) {
	mux, _, _ := newEvalHTTPEnv(t)

	createPayload := `{
		"evaluator_id":"  custom.helpfulness  ",
		"version":" 2026-02-17 ",
		"kind":"heuristic",
		"config":{"not_empty":true},
		"output_keys":[{"key":"helpfulness","type":"bool"}]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/evaluators", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create evaluator, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	var created evalpkg.EvaluatorDefinition
	if err := json.Unmarshal(createResp.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.EvaluatorID != "custom.helpfulness" {
		t.Errorf("expected trimmed evaluator_id, got %q", created.EvaluatorID)
	}
	if created.Version != "2026-02-17" {
		t.Errorf("expected trimmed version, got %q", created.Version)
	}

	getResp := doRequest(mux, http.MethodGet, "/api/v1/eval/evaluators/custom.helpfulness", "")
	if getResp.Code != http.StatusOK {
		t.Errorf("expected 200 get evaluator using trimmed id, got %d body=%s", getResp.Code, getResp.Body.String())
	}
}

func TestCreateEvaluatorRejectsMultipleOutputKeys(t *testing.T) {
	mux, _, _ := newEvalHTTPEnv(t)

	createPayload := `{
		"evaluator_id":"custom.multi-output",
		"version":"2026-02-17",
		"kind":"heuristic",
		"config":{"not_empty":true},
		"output_keys":[
			{"key":"helpfulness","type":"bool"},
			{"key":"conciseness","type":"bool"}
		]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/evaluators", createPayload)
	if createResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 create evaluator, got %d body=%s", createResp.Code, createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), "exactly one key") {
		t.Errorf("expected single-output validation error, got body=%s", createResp.Body.String())
	}
}

func TestCreateEvaluatorReturnsInternalServerErrorOnStoreFailure(t *testing.T) {
	mux, _, store := newEvalHTTPEnv(t)
	store.createEvaluatorErr = errors.New("mysql unavailable")

	createPayload := `{
		"evaluator_id":"custom.helpfulness",
		"version":"2026-02-17",
		"kind":"heuristic",
		"config":{"not_empty":true},
		"output_keys":[{"key":"helpfulness","type":"bool"}]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/evaluators", createPayload)
	if createResp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 create evaluator on store failure, got %d body=%s", createResp.Code, createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), "internal server error") {
		t.Errorf("expected generic internal server error body, got body=%s", createResp.Body.String())
	}
}

func TestRuleCRUDHTTP(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "fake",
		EvaluatorID: "custom.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config:      map[string]any{"not_empty": true},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}

	service := NewService(store, nil)
	mux := newEvalMux(service)

	createPayload := `{
		"rule_id":"rule-helpfulness",
		"enabled":true,
		"selector":"user_visible_turn",
		"match":{"agent_name":["assistant-*" ]},
		"sample_rate":0.5,
		"evaluator_ids":["custom.helpfulness"]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create rule, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/rules", "")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200 list rules, got %d body=%s", listResp.Code, listResp.Body.String())
	}
	if !strings.Contains(listResp.Body.String(), `"rule-helpfulness"`) {
		t.Errorf("expected rule id in list response, body=%s", listResp.Body.String())
	}

	patchResp := doRequest(mux, http.MethodPatch, "/api/v1/eval/rules/rule-helpfulness", `{"enabled":false}`)
	if patchResp.Code != http.StatusOK {
		t.Fatalf("expected 200 patch rule, got %d body=%s", patchResp.Code, patchResp.Body.String())
	}
	if !strings.Contains(patchResp.Body.String(), `"enabled":false`) {
		t.Errorf("expected enabled=false after patch, body=%s", patchResp.Body.String())
	}

	deleteResp := doRequest(mux, http.MethodDelete, "/api/v1/eval/rules/rule-helpfulness", "")
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("expected 204 delete rule, got %d body=%s", deleteResp.Code, deleteResp.Body.String())
	}
	deleteResp = doRequest(mux, http.MethodDelete, "/api/v1/eval/rules/rule-helpfulness", "")
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("expected idempotent 204 delete rule, got %d body=%s", deleteResp.Code, deleteResp.Body.String())
	}
}

func TestRuleByIDAcceptsEscapedSlashInRuleID(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID: "fake", EvaluatorID: "e1", Version: "v1", Kind: evalpkg.EvaluatorKindHeuristic,
		Config: map[string]any{}, OutputKeys: []evalpkg.OutputKey{{Key: "ok", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}
	createPayload := `{"rule_id":"ns/rule-name","selector":"user_visible_turn","sample_rate":1.0,"evaluator_ids":["e1"]}`
	service := NewService(store, nil)
	mux := newEvalMux(service)

	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create rule, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	// Delete using URL-encoded slash (%2F) in path
	deleteResp := doRequest(mux, http.MethodDelete, "/api/v1/eval/rules/ns%2Frule-name", "")
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("expected 204 delete rule with slash in id, got %d body=%s", deleteResp.Code, deleteResp.Body.String())
	}
}

func TestEnableRuleRejectsMissingEvaluators(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "fake",
		EvaluatorID: "custom.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config:      map[string]any{"not_empty": true},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}

	service := NewService(store, nil)
	mux := newEvalMux(service)

	createPayload := `{
		"rule_id":"rule-helpfulness",
		"enabled":false,
		"selector":"user_visible_turn",
		"sample_rate":1.0,
		"evaluator_ids":["custom.helpfulness"]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create disabled rule, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	deleteResp := doRequest(mux, http.MethodDelete, "/api/v1/eval/evaluators/custom.helpfulness", "")
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("expected 204 delete evaluator referenced only by disabled rule, got %d body=%s", deleteResp.Code, deleteResp.Body.String())
	}

	enableResp := doRequest(mux, http.MethodPatch, "/api/v1/eval/rules/rule-helpfulness", `{"enabled":true}`)
	if enableResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 enable rule with missing evaluator, got %d body=%s", enableResp.Code, enableResp.Body.String())
	}
	if !strings.Contains(enableResp.Body.String(), `evaluator "custom.helpfulness" was not found`) {
		t.Errorf("expected missing evaluator error, got body=%s", enableResp.Body.String())
	}
}

func TestCreateRuleDefaultsEnabledAndSampleRateWhenOmitted(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "fake",
		EvaluatorID: "custom.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config:      map[string]any{"not_empty": true},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}

	service := NewService(store, nil)
	mux := newEvalMux(service)

	createPayload := `{
		"rule_id":"rule-defaults",
		"evaluator_ids":["custom.helpfulness"]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create rule with defaults, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	var created evalpkg.RuleDefinition
	if err := json.Unmarshal(createResp.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if !created.Enabled {
		t.Errorf("expected enabled default true")
	}
	if created.SampleRate != defaultRuleSampleRate {
		t.Errorf("expected sample_rate default %v, got %v", defaultRuleSampleRate, created.SampleRate)
	}
	if created.Selector != evalpkg.SelectorUserVisibleTurn {
		t.Errorf("expected selector default %q, got %q", evalpkg.SelectorUserVisibleTurn, created.Selector)
	}
}

func TestCreateRuleSupportsExplicitZeroSamplingAndDisabled(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "fake",
		EvaluatorID: "custom.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config:      map[string]any{"not_empty": true},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}

	service := NewService(store, nil)
	mux := newEvalMux(service)

	createPayload := `{
		"rule_id":"rule-explicit-zero",
		"enabled":false,
		"sample_rate":0,
		"evaluator_ids":["custom.helpfulness"]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create explicit-zero rule, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	var created evalpkg.RuleDefinition
	if err := json.Unmarshal(createResp.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Enabled {
		t.Errorf("expected explicit enabled=false to be preserved")
	}
	if created.SampleRate != 0 {
		t.Errorf("expected explicit sample_rate=0 to be preserved, got %v", created.SampleRate)
	}
}

func TestCreateRuleReturnsInternalServerErrorOnStoreFailure(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "fake",
		EvaluatorID: "custom.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config:      map[string]any{"not_empty": true},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}
	store.createRuleErr = errors.New("insert failed")

	service := NewService(store, nil)
	mux := newEvalMux(service)

	createPayload := `{
		"rule_id":"rule-backend-failure",
		"evaluator_ids":["custom.helpfulness"]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createPayload)
	if createResp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 create rule on store failure, got %d body=%s", createResp.Code, createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), "internal server error") {
		t.Errorf("expected generic internal server error body, got body=%s", createResp.Body.String())
	}
}

func TestCreateRuleRejectsUnsupportedMatchKeys(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "fake",
		EvaluatorID: "custom.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config:      map[string]any{"not_empty": true},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}

	service := NewService(store, nil)
	mux := newEvalMux(service)

	createPayload := `{
		"rule_id":"rule-invalid-match",
		"match":{"model.provier":"openai"},
		"evaluator_ids":["custom.helpfulness"]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createPayload)
	if createResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 create invalid rule, got %d body=%s", createResp.Code, createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), "unsupported match key") {
		t.Errorf("expected unsupported match key error, got body=%s", createResp.Body.String())
	}
}

func TestCreateRuleRejectsInvalidMatchValueTypes(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "fake",
		EvaluatorID: "custom.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config:      map[string]any{"not_empty": true},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}

	service := NewService(store, nil)
	mux := newEvalMux(service)

	testCases := []struct {
		name        string
		matchJSON   string
		expectError string
	}{
		{
			name:        "scalar_non_string",
			matchJSON:   `{"mode":1}`,
			expectError: `match["mode"] must be a string or array of strings`,
		},
		{
			name:        "array_non_string_values",
			matchJSON:   `{"tags.env":[1,2]}`,
			expectError: `match["tags.env"] array item 0 must be a string`,
		},
		{
			name:        "glob_syntax_error_scalar",
			matchJSON:   `{"agent_name":"assistant-["}`,
			expectError: `match["agent_name"] value "assistant-[" has invalid glob pattern`,
		},
		{
			name:        "glob_syntax_error_array",
			matchJSON:   `{"model.name":["gpt-*","claude-["]}`,
			expectError: `match["model.name"] value "claude-[" has invalid glob pattern`,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			createPayload := `{
				"rule_id":"rule-invalid-match-value-` + testCase.name + `",
				"match":` + testCase.matchJSON + `,
				"evaluator_ids":["custom.helpfulness"]
			}`
			createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createPayload)
			if createResp.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 create invalid rule, got %d body=%s", createResp.Code, createResp.Body.String())
			}
			if !strings.Contains(createResp.Body.String(), testCase.expectError) {
				t.Errorf("expected %q, got body=%s", testCase.expectError, createResp.Body.String())
			}
		})
	}
}

func TestCreateRuleNormalizesRuleIDAndMatchKeysWithWhitespace(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "fake",
		EvaluatorID: "custom.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config:      map[string]any{"not_empty": true},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}

	service := NewService(store, nil)
	mux := newEvalMux(service)

	createPayload := `{
		"rule_id":"  rule-whitespace  ",
		"match":{" agent_name ":["assistant-*"],"tags. env ":["prod"]},
		"evaluator_ids":[" custom.helpfulness "]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create rule, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	var created evalpkg.RuleDefinition
	if err := json.Unmarshal(createResp.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.RuleID != "rule-whitespace" {
		t.Errorf("expected trimmed rule_id, got %q", created.RuleID)
	}
	if len(created.EvaluatorIDs) != 1 || created.EvaluatorIDs[0] != "custom.helpfulness" {
		t.Errorf("expected trimmed evaluator_ids, got %#v", created.EvaluatorIDs)
	}
	if _, ok := created.Match["agent_name"]; !ok {
		t.Errorf("expected normalized match key agent_name, got %#v", created.Match)
	}
	if _, ok := created.Match["tags.env"]; !ok {
		t.Errorf("expected normalized match key tags.env, got %#v", created.Match)
	}
	if _, ok := created.Match[" agent_name "]; ok {
		t.Errorf("unexpected unnormalized key in match map: %#v", created.Match)
	}
}

func TestCreateRuleRejectsDuplicateMatchKeysAfterNormalization(t *testing.T) {
	store := newMemoryControlStore()
	if err := store.CreateEvaluator(context.Background(), evalpkg.EvaluatorDefinition{
		TenantID:    "fake",
		EvaluatorID: "custom.helpfulness",
		Version:     "2026-02-17",
		Kind:        evalpkg.EvaluatorKindHeuristic,
		Config:      map[string]any{"not_empty": true},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeBool}},
	}); err != nil {
		t.Fatalf("seed evaluator: %v", err)
	}

	service := NewService(store, nil)
	mux := newEvalMux(service)

	createPayload := `{
		"rule_id":"rule-dup-match-key",
		"match":{"agent_name":["assistant-a"]," agent_name ":["assistant-b"]},
		"evaluator_ids":["custom.helpfulness"]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createPayload)
	if createResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 create invalid rule, got %d body=%s", createResp.Code, createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), `duplicate match key "agent_name"`) {
		t.Errorf("expected duplicate normalized match key error, got body=%s", createResp.Body.String())
	}
}

func TestJudgeDiscoveryHTTP(t *testing.T) {
	store := newMemoryControlStore()
	service := NewService(store, staticJudgeDiscovery{})
	mux := newEvalMux(service)

	providersResp := doRequest(mux, http.MethodGet, "/api/v1/eval/judge/providers", "")
	if providersResp.Code != http.StatusOK {
		t.Fatalf("expected 200 providers, got %d body=%s", providersResp.Code, providersResp.Body.String())
	}
	if !strings.Contains(providersResp.Body.String(), `"openai"`) {
		t.Errorf("expected provider in response, body=%s", providersResp.Body.String())
	}

	modelsResp := doRequest(mux, http.MethodGet, "/api/v1/eval/judge/models?provider=openai", "")
	if modelsResp.Code != http.StatusOK {
		t.Fatalf("expected 200 models, got %d body=%s", modelsResp.Code, modelsResp.Body.String())
	}
	if !strings.Contains(modelsResp.Body.String(), `"gpt-4o-mini"`) {
		t.Errorf("expected model in response, body=%s", modelsResp.Body.String())
	}
}

func TestJudgeModelsHTTPRequiresProviderQueryParam(t *testing.T) {
	store := newMemoryControlStore()
	service := NewService(store, staticJudgeDiscovery{})
	mux := newEvalMux(service)

	modelsResp := doRequest(mux, http.MethodGet, "/api/v1/eval/judge/models", "")
	if modelsResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing provider query param, got %d body=%s", modelsResp.Code, modelsResp.Body.String())
	}
	if !strings.Contains(modelsResp.Body.String(), "provider query param is required") {
		t.Errorf("expected validation error in response body, got body=%s", modelsResp.Body.String())
	}
}

func TestJudgeModelsHTTPReturnsInternalServerErrorForDiscoveryFailure(t *testing.T) {
	store := newMemoryControlStore()
	service := NewService(store, failingJudgeDiscovery{err: errors.New("discovery unavailable")})
	mux := newEvalMux(service)

	modelsResp := doRequest(mux, http.MethodGet, "/api/v1/eval/judge/models?provider=openai", "")
	if modelsResp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 for discovery failure, got %d body=%s", modelsResp.Code, modelsResp.Body.String())
	}
	if !strings.Contains(modelsResp.Body.String(), "internal server error") {
		t.Errorf("expected generic internal server error body, got body=%s", modelsResp.Body.String())
	}
}

func TestJudgeDiscoveryHTTPRequiresTenantContext(t *testing.T) {
	store := newMemoryControlStore()
	service := NewService(store, staticJudgeDiscovery{})
	mux := http.NewServeMux()
	RegisterHTTPRoutes(mux, service, nil, nil, nil)

	providersResp := doRequest(mux, http.MethodGet, "/api/v1/eval/judge/providers", "")
	if providersResp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 providers without tenant context, got %d body=%s", providersResp.Code, providersResp.Body.String())
	}

	modelsResp := doRequest(mux, http.MethodGet, "/api/v1/eval/judge/models?provider=openai", "")
	if modelsResp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 models without tenant context, got %d body=%s", modelsResp.Code, modelsResp.Body.String())
	}
}

func TestPredefinedEvaluatorsHTTP(t *testing.T) {
	mux, _, _ := newEvalHTTPEnv(t)

	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/predefined/evaluators", "")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200 list predefined evaluators, got %d body=%s", listResp.Code, listResp.Body.String())
	}
	if !strings.Contains(listResp.Body.String(), `"sigil.helpfulness"`) {
		t.Errorf("expected predefined template id in list response, body=%s", listResp.Body.String())
	}
}

func TestForkPredefinedEvaluatorHTTP(t *testing.T) {
	mux, _, _ := newEvalHTTPEnv(t)

	forkPayload := `{
		"evaluator_id":"custom.helpfulness",
		"version":"2026-02-18",
		"config":{
			"provider":"google",
			"model":"gemini-2.0-flash"
		}
	}`
	forkResp := doRequest(mux, http.MethodPost, "/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork", forkPayload)
	if forkResp.Code != http.StatusOK {
		t.Fatalf("expected 200 fork predefined evaluator, got %d body=%s", forkResp.Code, forkResp.Body.String())
	}
	if !strings.Contains(forkResp.Body.String(), `"custom.helpfulness"`) {
		t.Errorf("expected forked evaluator id in response, body=%s", forkResp.Body.String())
	}
	if !strings.Contains(forkResp.Body.String(), `"provider":"google"`) {
		t.Errorf("expected forked evaluator config override in response, body=%s", forkResp.Body.String())
	}

	getResp := doRequest(mux, http.MethodGet, "/api/v1/eval/evaluators/custom.helpfulness", "")
	if getResp.Code != http.StatusOK {
		t.Errorf("expected 200 get forked evaluator, got %d body=%s", getResp.Code, getResp.Body.String())
	}
}

func TestForkPredefinedEvaluatorReturnsInternalServerErrorOnStoreFailure(t *testing.T) {
	mux, _, store := newEvalHTTPEnv(t)
	store.createEvaluatorErr = errors.New("write failed")

	forkPayload := `{
		"evaluator_id":"custom.helpfulness",
		"version":"2026-02-18",
		"config":{"provider":"google","model":"gemini-2.0-flash"}
	}`
	forkResp := doRequest(mux, http.MethodPost, "/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork", forkPayload)
	if forkResp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 fork predefined evaluator on store failure, got %d body=%s", forkResp.Code, forkResp.Body.String())
	}
	if !strings.Contains(forkResp.Body.String(), "internal server error") {
		t.Errorf("expected generic internal server error body, got body=%s", forkResp.Body.String())
	}
}

func TestPredefinedEndpoints_BackwardsCompatible_WithTemplateStore(t *testing.T) {
	templateStore := newMemoryTemplateStore()
	if err := BootstrapPredefinedTemplates(context.Background(), templateStore); err != nil {
		t.Fatalf("bootstrap predefined templates: %v", err)
	}

	evalStore := newMemoryControlStore()
	service := NewService(evalStore, nil, WithTemplateStore(templateStore))
	mux := newEvalMux(service)

	// List predefined evaluators — should return all 11 templates with correct shape.
	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/predefined/evaluators", "")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200 list predefined evaluators, got %d body=%s", listResp.Code, listResp.Body.String())
	}

	var listBody struct {
		Items []evalpkg.EvaluatorDefinition `json:"items"`
	}
	if err := json.Unmarshal(listResp.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(listBody.Items) != 10 {
		t.Errorf("expected 10 predefined evaluators from templates table, got %d", len(listBody.Items))
	}

	// Verify response shape for each item.
	foundHelpfulness := false
	for _, item := range listBody.Items {
		if !item.IsPredefined {
			t.Errorf("expected is_predefined=true for %q", item.EvaluatorID)
		}
		if item.TenantID != "" {
			t.Errorf("expected empty tenant_id for predefined, got %q", item.TenantID)
		}
		if item.EvaluatorID == "" {
			t.Error("expected non-empty evaluator_id")
		}
		if item.Version == "" {
			t.Error("expected non-empty version")
		}
		if item.Kind == "" {
			t.Error("expected non-empty kind")
		}
		if len(item.OutputKeys) == 0 {
			t.Errorf("expected non-empty output_keys for %q", item.EvaluatorID)
		}
		if item.EvaluatorID == "sigil.helpfulness" {
			foundHelpfulness = true
		}
	}
	if !foundHelpfulness {
		t.Error("expected sigil.helpfulness in predefined list")
	}

	// Fork with template store — should set lineage fields.
	forkPayload := `{
		"evaluator_id":"custom.helpfulness",
		"version":"2026-02-18",
		"config":{"provider":"google","model":"gemini-2.0-flash"}
	}`
	forkResp := doRequest(mux, http.MethodPost, "/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork", forkPayload)
	if forkResp.Code != http.StatusOK {
		t.Fatalf("expected 200 fork predefined evaluator, got %d body=%s", forkResp.Code, forkResp.Body.String())
	}

	var forked evalpkg.EvaluatorDefinition
	if err := json.Unmarshal(forkResp.Body.Bytes(), &forked); err != nil {
		t.Fatalf("decode fork response: %v", err)
	}
	if forked.EvaluatorID != "custom.helpfulness" {
		t.Errorf("expected evaluator_id=custom.helpfulness, got %q", forked.EvaluatorID)
	}
	if forked.SourceTemplateID != "sigil.helpfulness" {
		t.Errorf("expected source_template_id=sigil.helpfulness, got %q", forked.SourceTemplateID)
	}
	if forked.SourceTemplateVersion != predefined.DefaultTemplateVersion {
		t.Errorf("expected source_template_version=%s, got %q", predefined.DefaultTemplateVersion, forked.SourceTemplateVersion)
	}
	if forked.Config["provider"] != "google" {
		t.Errorf("expected config.provider=google, got %v", forked.Config["provider"])
	}
	if forked.IsPredefined {
		t.Error("expected forked evaluator is_predefined=false")
	}
}

func TestPredefinedEndpoints_FallbackToHardcoded_WithNilTemplateStore(t *testing.T) {
	mux, _, _ := newEvalHTTPEnv(t) // No template store — should use hardcoded.

	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/predefined/evaluators", "")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", listResp.Code, listResp.Body.String())
	}

	var listBody struct {
		Items []evalpkg.EvaluatorDefinition `json:"items"`
	}
	if err := json.Unmarshal(listResp.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(listBody.Items) != 10 {
		t.Errorf("expected 10 hardcoded predefined evaluators, got %d", len(listBody.Items))
	}
	for _, item := range listBody.Items {
		if !item.IsPredefined {
			t.Errorf("expected is_predefined=true for %q", item.EvaluatorID)
		}
	}

	// Fork should work using hardcoded fallback (no lineage fields).
	forkPayload := `{
		"evaluator_id":"custom.helpfulness-fallback",
		"config":{"provider":"openai"}
	}`
	forkResp := doRequest(mux, http.MethodPost, "/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork", forkPayload)
	if forkResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", forkResp.Code, forkResp.Body.String())
	}

	var forked evalpkg.EvaluatorDefinition
	if err := json.Unmarshal(forkResp.Body.Bytes(), &forked); err != nil {
		t.Fatalf("decode fork response: %v", err)
	}
	if forked.SourceTemplateID != "" {
		t.Errorf("expected empty source_template_id in hardcoded fallback, got %q", forked.SourceTemplateID)
	}
}

func TestPredefinedEndpoints_TemplateStoreFallbackToHardcoded(t *testing.T) {
	// Template store present but empty (no bootstrap) — simulates a transient DB
	// error at startup where BootstrapPredefinedTemplates fails but
	// WithTemplateStore is still registered.
	emptyTemplateStore := newMemoryTemplateStore()
	evalStore := newMemoryControlStore()
	service := NewService(evalStore, nil, WithTemplateStore(emptyTemplateStore))
	mux := newEvalMux(service)

	// List should fall back to hardcoded templates when store returns empty.
	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/predefined/evaluators", "")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200 list predefined evaluators, got %d body=%s", listResp.Code, listResp.Body.String())
	}
	var listBody struct{ Items []evalpkg.EvaluatorDefinition }
	if err := json.Unmarshal(listResp.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(listBody.Items) == 0 {
		t.Fatal("expected hardcoded predefined evaluators from fallback, got empty list")
	}
	for _, item := range listBody.Items {
		if !item.IsPredefined {
			t.Errorf("expected is_predefined=true for %q", item.EvaluatorID)
		}
	}

	// Fork should succeed via hardcoded fallback.
	forkPayload := `{
		"evaluator_id":"custom.helpfulness-from-hardcoded",
		"config":{"provider":"openai"}
	}`
	forkResp := doRequest(mux, http.MethodPost, "/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork", forkPayload)
	if forkResp.Code != http.StatusOK {
		t.Fatalf("expected 200 fork via hardcoded fallback, got %d body=%s", forkResp.Code, forkResp.Body.String())
	}

	var forked evalpkg.EvaluatorDefinition
	if err := json.Unmarshal(forkResp.Body.Bytes(), &forked); err != nil {
		t.Fatalf("decode fork response: %v", err)
	}
	if forked.EvaluatorID != "custom.helpfulness-from-hardcoded" {
		t.Errorf("expected evaluator_id=custom.helpfulness-from-hardcoded, got %q", forked.EvaluatorID)
	}
	// Hardcoded fallback produces no lineage fields.
	if forked.SourceTemplateID != "" {
		t.Errorf("expected empty source_template_id from hardcoded fallback, got %q", forked.SourceTemplateID)
	}
	if forked.SourceTemplateVersion != "" {
		t.Errorf("expected empty source_template_version from hardcoded fallback, got %q", forked.SourceTemplateVersion)
	}
}

func TestCreateRuleRejectsPredefinedTemplateReferenceWithoutFork(t *testing.T) {
	mux, _, _ := newEvalHTTPEnv(t)

	createRulePayload := `{
		"rule_id":"rule-helpfulness",
		"enabled":true,
		"selector":"user_visible_turn",
		"sample_rate":0.1,
		"evaluator_ids":["sigil.helpfulness"]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules", createRulePayload)
	if createResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 create rule with unforked predefined evaluator, got %d body=%s", createResp.Code, createResp.Body.String())
	}
	if !strings.Contains(createResp.Body.String(), `evaluator "sigil.helpfulness" was not found`) {
		t.Errorf("expected missing evaluator error, body=%s", createResp.Body.String())
	}
}

func newEvalHTTPEnv(t *testing.T) (*http.ServeMux, *Service, *memoryControlStore) {
	t.Helper()
	store := newMemoryControlStore()
	service := NewService(store, nil)
	mux := newEvalMux(service)
	return mux, service, store
}

func newEvalMux(service *Service) *http.ServeMux {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterHTTPRoutes(mux, service, nil, nil, protected)
	return mux
}

func doRequest(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if strings.TrimSpace(body) != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

type staticJudgeDiscovery struct{}

func (staticJudgeDiscovery) ListProviders(context.Context) []JudgeProvider {
	return []JudgeProvider{{ID: "openai", Name: "OpenAI", Type: "direct"}}
}

func (staticJudgeDiscovery) ListModels(context.Context, string) ([]JudgeModel, error) {
	return []JudgeModel{{ID: "gpt-4o-mini", Name: "GPT-4o mini", Provider: "openai", ContextWindow: 128000}}, nil
}

type failingJudgeDiscovery struct {
	err error
}

func (failingJudgeDiscovery) ListProviders(context.Context) []JudgeProvider {
	return []JudgeProvider{{ID: "openai", Name: "OpenAI", Type: "direct"}}
}

func (d failingJudgeDiscovery) ListModels(context.Context, string) ([]JudgeModel, error) {
	return nil, d.err
}

type memoryControlStore struct {
	evaluators         map[string]evalpkg.EvaluatorDefinition
	rules              map[string]evalpkg.RuleDefinition
	createEvaluatorErr error
	createRuleErr      error
}

func newMemoryControlStore() *memoryControlStore {
	return &memoryControlStore{
		evaluators: map[string]evalpkg.EvaluatorDefinition{},
		rules:      map[string]evalpkg.RuleDefinition{},
	}
}

func (s *memoryControlStore) CreateEvaluator(_ context.Context, evaluator evalpkg.EvaluatorDefinition) error {
	if s.createEvaluatorErr != nil {
		return s.createEvaluatorErr
	}
	now := time.Now().UTC()
	if evaluator.CreatedAt.IsZero() {
		evaluator.CreatedAt = now
	}
	evaluator.UpdatedAt = now
	evaluator.DeletedAt = nil
	s.evaluators[evaluatorKey(evaluator.TenantID, evaluator.EvaluatorID, evaluator.Version)] = evaluator
	return nil
}

func (s *memoryControlStore) GetEvaluator(_ context.Context, tenantID, evaluatorID string) (*evalpkg.EvaluatorDefinition, error) {
	var latest *evalpkg.EvaluatorDefinition
	for _, evaluator := range s.evaluators {
		if evaluator.TenantID != tenantID || evaluator.EvaluatorID != evaluatorID || evaluator.DeletedAt != nil {
			continue
		}
		if latest == nil || evaluator.UpdatedAt.After(latest.UpdatedAt) {
			copied := evaluator
			latest = &copied
		}
	}
	return latest, nil
}

func (s *memoryControlStore) GetEvaluatorVersion(_ context.Context, tenantID, evaluatorID, version string) (*evalpkg.EvaluatorDefinition, error) {
	evaluator, ok := s.evaluators[evaluatorKey(tenantID, evaluatorID, version)]
	if !ok || evaluator.DeletedAt != nil {
		return nil, nil
	}
	copied := evaluator
	return &copied, nil
}

func (s *memoryControlStore) ListEvaluators(_ context.Context, tenantID string, limit int, cursor uint64) ([]evalpkg.EvaluatorDefinition, uint64, error) {
	items := make([]evalpkg.EvaluatorDefinition, 0)
	for _, evaluator := range s.evaluators {
		if evaluator.TenantID != tenantID || evaluator.DeletedAt != nil {
			continue
		}
		items = append(items, evaluator)
	}
	sort.Slice(items, func(i, j int) bool {
		left := items[i].EvaluatorID + ":" + items[i].Version
		right := items[j].EvaluatorID + ":" + items[j].Version
		return left < right
	})
	return paginateEvaluators(items, limit, cursor)
}

func (s *memoryControlStore) DeleteEvaluator(_ context.Context, tenantID, evaluatorID string) error {
	now := time.Now().UTC()
	for key, evaluator := range s.evaluators {
		if evaluator.TenantID != tenantID || evaluator.EvaluatorID != evaluatorID {
			continue
		}
		evaluator.DeletedAt = &now
		evaluator.UpdatedAt = now
		s.evaluators[key] = evaluator
	}
	return nil
}

func (s *memoryControlStore) CountActiveEvaluators(_ context.Context, tenantID string) (int64, error) {
	seen := map[string]struct{}{}
	for _, evaluator := range s.evaluators {
		if evaluator.TenantID != tenantID || evaluator.DeletedAt != nil {
			continue
		}
		seen[evaluator.EvaluatorID] = struct{}{}
	}
	return int64(len(seen)), nil
}

func (s *memoryControlStore) CreateRule(_ context.Context, rule evalpkg.RuleDefinition) error {
	if s.createRuleErr != nil {
		return s.createRuleErr
	}
	now := time.Now().UTC()
	if rule.CreatedAt.IsZero() {
		rule.CreatedAt = now
	}
	rule.UpdatedAt = now
	rule.DeletedAt = nil
	s.rules[ruleKey(rule.TenantID, rule.RuleID)] = rule
	return nil
}

func (s *memoryControlStore) GetRule(_ context.Context, tenantID, ruleID string) (*evalpkg.RuleDefinition, error) {
	rule, ok := s.rules[ruleKey(tenantID, ruleID)]
	if !ok || rule.DeletedAt != nil {
		return nil, nil
	}
	copied := rule
	return &copied, nil
}

func (s *memoryControlStore) ListRules(_ context.Context, tenantID string, limit int, cursor uint64) ([]evalpkg.RuleDefinition, uint64, error) {
	items := make([]evalpkg.RuleDefinition, 0)
	for _, rule := range s.rules {
		if rule.TenantID != tenantID || rule.DeletedAt != nil {
			continue
		}
		items = append(items, rule)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].RuleID < items[j].RuleID })
	return paginateRules(items, limit, cursor)
}

func (s *memoryControlStore) UpdateRule(_ context.Context, rule evalpkg.RuleDefinition) error {
	existing, ok := s.rules[ruleKey(rule.TenantID, rule.RuleID)]
	if !ok || existing.DeletedAt != nil {
		return evalpkg.ErrNotFound
	}
	rule.CreatedAt = existing.CreatedAt
	rule.UpdatedAt = time.Now().UTC()
	rule.DeletedAt = nil
	s.rules[ruleKey(rule.TenantID, rule.RuleID)] = rule
	return nil
}

func (s *memoryControlStore) DeleteRule(_ context.Context, tenantID, ruleID string) error {
	key := ruleKey(tenantID, ruleID)
	rule, ok := s.rules[key]
	if !ok {
		return nil
	}
	now := time.Now().UTC()
	rule.DeletedAt = &now
	rule.UpdatedAt = now
	s.rules[key] = rule
	return nil
}

func (s *memoryControlStore) CountActiveRules(_ context.Context, tenantID string) (int64, error) {
	count := int64(0)
	for _, rule := range s.rules {
		if rule.TenantID != tenantID || rule.DeletedAt != nil || !rule.Enabled {
			continue
		}
		count++
	}
	return count, nil
}

func evaluatorKey(tenantID, evaluatorID, version string) string {
	return tenantID + "|" + evaluatorID + "|" + version
}

func ruleKey(tenantID, ruleID string) string {
	return tenantID + "|" + ruleID
}

func paginateEvaluators(items []evalpkg.EvaluatorDefinition, limit int, cursor uint64) ([]evalpkg.EvaluatorDefinition, uint64, error) {
	if limit <= 0 {
		limit = 50
	}
	start := int(cursor)
	if start >= len(items) {
		return []evalpkg.EvaluatorDefinition{}, 0, nil
	}
	end := start + limit
	if end > len(items) {
		end = len(items)
	}
	nextCursor := uint64(0)
	if end < len(items) {
		nextCursor = uint64(end)
	}
	return append([]evalpkg.EvaluatorDefinition(nil), items[start:end]...), nextCursor, nil
}

func paginateRules(items []evalpkg.RuleDefinition, limit int, cursor uint64) ([]evalpkg.RuleDefinition, uint64, error) {
	if limit <= 0 {
		limit = 50
	}
	start := int(cursor)
	if start >= len(items) {
		return []evalpkg.RuleDefinition{}, 0, nil
	}
	end := start + limit
	if end > len(items) {
		end = len(items)
	}
	nextCursor := uint64(0)
	if end < len(items) {
		nextCursor = uint64(end)
	}
	return append([]evalpkg.RuleDefinition(nil), items[start:end]...), nextCursor, nil
}
