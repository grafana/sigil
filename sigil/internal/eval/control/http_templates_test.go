package control

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/grafana/sigil/sigil/internal/tenantauth"
)

func newTemplateMux(tmplSvc *TemplateService, evalSvc *Service) *http.ServeMux {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterHTTPRoutes(mux, evalSvc, tmplSvc, nil, protected)
	return mux
}

func newTemplateHTTPEnv(t *testing.T) (*http.ServeMux, *memoryTemplateStore, *memoryControlStore) {
	t.Helper()
	ts := newMemoryTemplateStore()
	cs := newMemoryControlStore()
	evalSvc := NewService(cs, nil)
	tmplSvc := NewTemplateService(ts, evalSvc)
	mux := newTemplateMux(tmplSvc, evalSvc)
	return mux, ts, cs
}

func TestTemplateHTTPCreateAndGet(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	createPayload := `{
		"template_id":"my_team.policy_check",
		"kind":"llm_judge",
		"description":"Policy compliance evaluator",
		"version":"2026-03-02",
		"config":{"provider":"openai","model":"gpt-4o-mini"},
		"output_keys":[{"key":"compliance","type":"number"}],
		"changelog":"Initial version"
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create template, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	var createBody map[string]any
	if err := json.Unmarshal(createResp.Body.Bytes(), &createBody); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if createBody["template_id"] != "my_team.policy_check" {
		t.Errorf("expected template_id=my_team.policy_check, got %v", createBody["template_id"])
	}
	if createBody["scope"] != "tenant" {
		t.Errorf("expected scope=tenant, got %v", createBody["scope"])
	}
	if createBody["kind"] != "llm_judge" {
		t.Errorf("expected kind=llm_judge, got %v", createBody["kind"])
	}
	versions, ok := createBody["versions"].([]any)
	if !ok || len(versions) != 1 {
		t.Errorf("expected versions array with 1 entry, got %v", createBody["versions"])
	}

	// GET by ID should include config and output_keys from latest version.
	getResp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates/my_team.policy_check", "")
	if getResp.Code != http.StatusOK {
		t.Fatalf("expected 200 get template, got %d body=%s", getResp.Code, getResp.Body.String())
	}

	var getBody map[string]any
	if err := json.Unmarshal(getResp.Body.Bytes(), &getBody); err != nil {
		t.Fatalf("decode get response: %v", err)
	}
	if getBody["config"] == nil {
		t.Fatalf("expected config in get response, body=%s", getResp.Body.String())
	}
	if getBody["output_keys"] == nil {
		t.Errorf("expected output_keys in get response, body=%s", getResp.Body.String())
	}
	config, _ := getBody["config"].(map[string]any)
	if config["provider"] != "openai" {
		t.Errorf("expected config.provider=openai, got %v", config["provider"])
	}
}

func TestTemplateHTTPCreateBadKind(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	createPayload := `{
		"template_id":"my_template",
		"kind":"unknown_kind",
		"version":"2026-03-02",
		"config":{"provider":"openai","model":"gpt-4o-mini"},
		"output_keys":[{"key":"score","type":"number"}]
	}`
	resp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", createPayload)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad kind, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "kind is invalid") {
		t.Errorf("expected 'kind is invalid' in error, got body=%s", resp.Body.String())
	}
}

func TestTemplateHTTPCreateBadVersionFormat(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	createPayload := `{
		"template_id":"my_template",
		"kind":"llm_judge",
		"version":"v1.0.0",
		"config":{"provider":"openai","model":"gpt-4o-mini"},
		"output_keys":[{"key":"score","type":"number"}]
	}`
	resp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", createPayload)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad version format, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "YYYY-MM-DD") {
		t.Errorf("expected YYYY-MM-DD format error, got body=%s", resp.Body.String())
	}
}

func TestTemplateHTTPListAll(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	// Create two templates.
	for _, id := range []string{"template_a", "template_b"} {
		payload := `{
			"template_id":"` + id + `",
			"kind":"heuristic",
			"version":"2026-03-02",
			"config":{"not_empty":true},
			"output_keys":[{"key":"score","type":"bool"}]
		}`
		resp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", payload)
		if resp.Code != http.StatusOK {
			t.Fatalf("expected 200 create %s, got %d body=%s", id, resp.Code, resp.Body.String())
		}
	}

	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates", "")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200 list templates, got %d body=%s", listResp.Code, listResp.Body.String())
	}

	var listBody map[string]any
	if err := json.Unmarshal(listResp.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	items, ok := listBody["items"].([]any)
	if !ok || len(items) < 2 {
		t.Errorf("expected at least 2 items, got %v", listBody["items"])
	}
}

func TestTemplateHTTPListWithScopeFilter(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	// Create a tenant template.
	payload := `{
		"template_id":"tenant_template",
		"kind":"heuristic",
		"version":"2026-03-02",
		"config":{"not_empty":true},
		"output_keys":[{"key":"score","type":"bool"}]
	}`
	resp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", payload)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200 create tenant template, got %d body=%s", resp.Code, resp.Body.String())
	}

	// Filter by tenant scope — should only return the tenant template.
	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates?scope=tenant", "")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200 list with scope filter, got %d body=%s", listResp.Code, listResp.Body.String())
	}

	var listBody map[string]any
	if err := json.Unmarshal(listResp.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	items, ok := listBody["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected exactly 1 tenant-scoped item, got %d items=%v", len(items), listBody["items"])
	}
	first := items[0].(map[string]any)
	if first["template_id"] != "tenant_template" {
		t.Errorf("expected tenant_template, got %v", first["template_id"])
	}
	globalOnlyResp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates?scope=global", "")
	if globalOnlyResp.Code != http.StatusOK {
		t.Fatalf("expected 200 list with global scope filter, got %d body=%s", globalOnlyResp.Code, globalOnlyResp.Body.String())
	}

	var globalOnlyBody map[string]any
	if err := json.Unmarshal(globalOnlyResp.Body.Bytes(), &globalOnlyBody); err != nil {
		t.Fatalf("decode global-scope list response: %v", err)
	}
	globalItems, ok := globalOnlyBody["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %v", globalOnlyBody["items"])
	}
	if len(globalItems) == 0 {
		t.Fatal("expected predefined global templates for global scope filter")
	}
}

func TestTemplateHTTPGetNonexistent(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	resp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates/nonexistent", "")
	if resp.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestTemplateHTTPDelete(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	// Create a template.
	payload := `{
		"template_id":"deletable",
		"kind":"heuristic",
		"version":"2026-03-02",
		"config":{"not_empty":true},
		"output_keys":[{"key":"score","type":"bool"}]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", payload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	deleteResp := doRequest(mux, http.MethodDelete, "/api/v1/eval/templates/deletable", "")
	if deleteResp.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", deleteResp.Code, deleteResp.Body.String())
	}

	// Verify deleted.
	getResp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates/deletable", "")
	if getResp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d body=%s", getResp.Code, getResp.Body.String())
	}
}

func TestTemplateHTTPGetPredefinedGlobal(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	resp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates/sigil.helpfulness", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200 get predefined template, got %d body=%s", resp.Code, resp.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode get response: %v", err)
	}
	if body["scope"] != "global" {
		t.Errorf("expected scope=global, got %v", body["scope"])
	}
	if body["template_id"] != "sigil.helpfulness" {
		t.Errorf("expected sigil.helpfulness, got %v", body["template_id"])
	}
	if body["config"] == nil {
		t.Fatalf("expected predefined config in get response, body=%s", resp.Body.String())
	}
	if versions, ok := body["versions"].([]any); !ok || len(versions) != 0 {
		t.Errorf("expected no version history entries for predefined global, got %v", body["versions"])
	}
}

func TestTemplateHTTPDeleteGlobalRejected(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	deleteResp := doRequest(mux, http.MethodDelete, "/api/v1/eval/templates/sigil.helpfulness", "")
	if deleteResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 delete global template, got %d body=%s", deleteResp.Code, deleteResp.Body.String())
	}
	if !strings.Contains(deleteResp.Body.String(), "cannot delete global templates") {
		t.Errorf("expected 'cannot delete global templates' in error, got body=%s", deleteResp.Body.String())
	}
}

func TestTemplateHTTPPublishVersion(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	// Create a template.
	createPayload := `{
		"template_id":"versioned",
		"kind":"llm_judge",
		"version":"2026-03-01",
		"config":{"provider":"openai","model":"gpt-4o-mini"},
		"output_keys":[{"key":"score","type":"number"}]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	// Publish a new version.
	publishPayload := `{
		"version":"2026-03-02",
		"config":{"provider":"openai","model":"gpt-4o"},
		"output_keys":[{"key":"score","type":"number"}],
		"changelog":"added model"
	}`
	publishResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates/versioned/versions", publishPayload)
	if publishResp.Code != http.StatusOK {
		t.Fatalf("expected 200 publish version, got %d body=%s", publishResp.Code, publishResp.Body.String())
	}

	var publishBody map[string]any
	if err := json.Unmarshal(publishResp.Body.Bytes(), &publishBody); err != nil {
		t.Fatalf("decode publish response: %v", err)
	}
	if publishBody["version"] != "2026-03-02" {
		t.Errorf("expected version=2026-03-02, got %v", publishBody["version"])
	}
}

func TestTemplateHTTPListVersions(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	// Create a template with initial version.
	createPayload := `{
		"template_id":"multi_ver",
		"kind":"heuristic",
		"version":"2026-03-01",
		"config":{"not_empty":true},
		"output_keys":[{"key":"score","type":"bool"}]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	// Publish a second version.
	publishPayload := `{
		"version":"2026-03-02",
		"config":{"contains":["v2"]},
		"output_keys":[{"key":"score","type":"bool"}]
	}`
	publishResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates/multi_ver/versions", publishPayload)
	if publishResp.Code != http.StatusOK {
		t.Fatalf("expected 200 publish, got %d body=%s", publishResp.Code, publishResp.Body.String())
	}

	// List versions.
	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates/multi_ver/versions", "")
	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200 list versions, got %d body=%s", listResp.Code, listResp.Body.String())
	}

	var listBody map[string]any
	if err := json.Unmarshal(listResp.Body.Bytes(), &listBody); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	items, ok := listBody["items"].([]any)
	if !ok || len(items) != 2 {
		t.Errorf("expected 2 versions, got %v", listBody["items"])
	}
}

func TestTemplateHTTPGetVersion(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	createPayload := `{
		"template_id":"get_ver",
		"kind":"llm_judge",
		"version":"2026-03-01",
		"config":{"provider":"openai","model":"gpt-4o-mini"},
		"output_keys":[{"key":"score","type":"number"}]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	getResp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates/get_ver/versions/2026-03-01", "")
	if getResp.Code != http.StatusOK {
		t.Fatalf("expected 200 get version, got %d body=%s", getResp.Code, getResp.Body.String())
	}

	var getBody map[string]any
	if err := json.Unmarshal(getResp.Body.Bytes(), &getBody); err != nil {
		t.Fatalf("decode get response: %v", err)
	}
	if getBody["version"] != "2026-03-01" {
		t.Errorf("expected version=2026-03-01, got %v", getBody["version"])
	}

	// Nonexistent version should 404.
	missingResp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates/get_ver/versions/2099-01-01", "")
	if missingResp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing version, got %d body=%s", missingResp.Code, missingResp.Body.String())
	}
}

func TestTemplateHTTPFork(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	// Create a template.
	createPayload := `{
		"template_id":"forkable",
		"kind":"llm_judge",
		"version":"2026-03-01",
		"config":{"provider":"openai","model":"gpt-4o-mini"},
		"output_keys":[{"key":"helpfulness","type":"number"}]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	// Fork the template.
	forkPayload := `{
		"evaluator_id":"custom.helpfulness"
	}`
	forkResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates/forkable:fork", forkPayload)
	if forkResp.Code != http.StatusOK {
		t.Fatalf("expected 200 fork, got %d body=%s", forkResp.Code, forkResp.Body.String())
	}

	var forkBody map[string]any
	if err := json.Unmarshal(forkResp.Body.Bytes(), &forkBody); err != nil {
		t.Fatalf("decode fork response: %v", err)
	}
	if forkBody["evaluator_id"] != "custom.helpfulness" {
		t.Errorf("expected evaluator_id=custom.helpfulness, got %v", forkBody["evaluator_id"])
	}
	if forkBody["source_template_id"] != "forkable" {
		t.Errorf("expected source_template_id=forkable, got %v", forkBody["source_template_id"])
	}
	if forkBody["source_template_version"] != "2026-03-01" {
		t.Errorf("expected source_template_version=2026-03-01, got %v", forkBody["source_template_version"])
	}

	// Verify the evaluator was created by fetching it.
	getResp := doRequest(mux, http.MethodGet, "/api/v1/eval/evaluators/custom.helpfulness", "")
	if getResp.Code != http.StatusOK {
		t.Fatalf("expected 200 get forked evaluator, got %d body=%s", getResp.Code, getResp.Body.String())
	}
}

func TestTemplateHTTPForkWithConfigOverrides(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	// Create a template.
	createPayload := `{
		"template_id":"forkable_override",
		"kind":"llm_judge",
		"version":"2026-03-01",
		"config":{"provider":"openai","model":"gpt-4o-mini","temperature":0.5},
		"output_keys":[{"key":"helpfulness","type":"number"}]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	// Fork with config overrides.
	forkPayload := `{
		"evaluator_id":"custom.overridden",
		"config":{"provider":"google","model":"gemini-2.0-flash"}
	}`
	forkResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates/forkable_override:fork", forkPayload)
	if forkResp.Code != http.StatusOK {
		t.Fatalf("expected 200 fork with overrides, got %d body=%s", forkResp.Code, forkResp.Body.String())
	}

	var forkBody map[string]any
	if err := json.Unmarshal(forkResp.Body.Bytes(), &forkBody); err != nil {
		t.Fatalf("decode fork response: %v", err)
	}
	config, _ := forkBody["config"].(map[string]any)
	if config["provider"] != "google" {
		t.Errorf("expected config.provider=google, got %v", config["provider"])
	}
	if config["model"] != "gemini-2.0-flash" {
		t.Errorf("expected config.model=gemini-2.0-flash, got %v", config["model"])
	}
	// Original temperature key should remain.
	if config["temperature"] != 0.5 {
		t.Errorf("expected config.temperature=0.5, got %v", config["temperature"])
	}
}

func TestTemplateHTTPForkRejectsPartialLLMJudgeOverride(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	createPayload := `{
		"template_id":"forkable_invalid",
		"kind":"llm_judge",
		"version":"2026-03-01",
		"config":{"provider":"openai","model":"gpt-4o-mini"},
		"output_keys":[{"key":"helpfulness","type":"number"}]
	}`
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", createPayload)
	if createResp.Code != http.StatusOK {
		t.Fatalf("expected 200 create, got %d body=%s", createResp.Code, createResp.Body.String())
	}

	forkPayload := `{
		"evaluator_id":"custom.invalid",
		"config":{"provider":"anthropic"}
	}`
	forkResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates/forkable_invalid:fork", forkPayload)
	if forkResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 fork with partial override, got %d body=%s", forkResp.Code, forkResp.Body.String())
	}
	if !strings.Contains(forkResp.Body.String(), "requires both provider and model") {
		t.Fatalf("expected provider/model validation error, got body=%s", forkResp.Body.String())
	}
}

func TestTemplateHTTPMethodNotAllowed(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	tests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "PUT on collection", method: http.MethodPut, path: "/api/v1/eval/templates"},
		{name: "GET on fork", method: http.MethodGet, path: "/api/v1/eval/templates/some_id:fork"},
		{name: "DELETE on versions", method: http.MethodDelete, path: "/api/v1/eval/templates/some_id/versions"},
		{name: "POST on version by ID", method: http.MethodPost, path: "/api/v1/eval/templates/some_id/versions/2026-01-01"},
		{name: "PUT on template by ID", method: http.MethodPut, path: "/api/v1/eval/templates/some_id"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := doRequest(mux, tt.method, tt.path, "")
			if resp.Code != http.StatusMethodNotAllowed {
				t.Fatalf("expected 405, got %d body=%s", resp.Code, resp.Body.String())
			}
		})
	}
}

func TestTemplateHTTPCreateBadJSON(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	resp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", `{invalid json`)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad JSON, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestTemplateHTTPForkBadJSON(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	resp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates/some_id:fork", `{bad`)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad JSON, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestTemplateHTTPForkNonexistent(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	resp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates/nonexistent:fork", `{"evaluator_id":"custom.test"}`)
	if resp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for fork nonexistent template, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "not found") {
		t.Errorf("expected 'not found' in error, got body=%s", resp.Body.String())
	}
}

func TestTemplateHTTPPublishVersionBadJSON(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	resp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates/some_id/versions", `{bad`)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad JSON, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestTemplateHTTPPublishVersionNonexistent(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	payload := `{
		"version":"2026-03-02",
		"config":{"provider":"openai","model":"gpt-4o-mini"},
		"output_keys":[{"key":"score","type":"number"}]
	}`
	resp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates/nonexistent/versions", payload)
	if resp.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for publish to nonexistent template, got %d body=%s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "not found") {
		t.Errorf("expected 'not found' in error, got body=%s", resp.Body.String())
	}
}

func TestTemplateHTTPListStoreError(t *testing.T) {
	mux, ts, _ := newTemplateHTTPEnv(t)
	ts.listErr = errors.New("store unavailable")

	resp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates", "")
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on store error, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestTemplateHTTPGetStoreError(t *testing.T) {
	mux, ts, _ := newTemplateHTTPEnv(t)
	ts.getErr = errors.New("store unavailable")

	resp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates/some_id", "")
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on store error, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestTemplateHTTPRoutingInvalidPaths(t *testing.T) {
	mux, _, _ := newTemplateHTTPEnv(t)

	tests := []struct {
		name string
		path string
		want int
	}{
		{name: "invalid second segment", path: "/api/v1/eval/templates/some_id/notversions", want: http.StatusBadRequest},
		{name: "empty version in version path", path: "/api/v1/eval/templates/some_id/versions/", want: http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := doRequest(mux, http.MethodGet, tt.path, "")
			if resp.Code != tt.want {
				t.Fatalf("expected %d, got %d body=%s", tt.want, resp.Code, resp.Body.String())
			}
		})
	}
}
