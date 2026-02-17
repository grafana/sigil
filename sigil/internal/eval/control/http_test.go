package control

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
)

func TestEvaluatorCRUDHTTP(t *testing.T) {
	store := newMemoryControlStore()
	service := NewService(store, nil, nil)
	mux := newEvalMux(service)

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
		t.Fatalf("expected evaluator id in list response, body=%s", listResp.Body.String())
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

	service := NewService(store, nil, nil)
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
		t.Fatalf("expected rule id in list response, body=%s", listResp.Body.String())
	}

	patchResp := doRequest(mux, http.MethodPatch, "/api/v1/eval/rules/rule-helpfulness", `{"enabled":false}`)
	if patchResp.Code != http.StatusOK {
		t.Fatalf("expected 200 patch rule, got %d body=%s", patchResp.Code, patchResp.Body.String())
	}
	if !strings.Contains(patchResp.Body.String(), `"enabled":false`) {
		t.Fatalf("expected enabled=false after patch, body=%s", patchResp.Body.String())
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

func TestJudgeDiscoveryHTTP(t *testing.T) {
	store := newMemoryControlStore()
	service := NewService(store, nil, staticJudgeDiscovery{})
	mux := newEvalMux(service)

	providersResp := doRequest(mux, http.MethodGet, "/api/v1/eval/judge/providers", "")
	if providersResp.Code != http.StatusOK {
		t.Fatalf("expected 200 providers, got %d body=%s", providersResp.Code, providersResp.Body.String())
	}
	if !strings.Contains(providersResp.Body.String(), `"openai"`) {
		t.Fatalf("expected provider in response, body=%s", providersResp.Body.String())
	}

	modelsResp := doRequest(mux, http.MethodGet, "/api/v1/eval/judge/models?provider=openai", "")
	if modelsResp.Code != http.StatusOK {
		t.Fatalf("expected 200 models, got %d body=%s", modelsResp.Code, modelsResp.Body.String())
	}
	if !strings.Contains(modelsResp.Body.String(), `"gpt-4o-mini"`) {
		t.Fatalf("expected model in response, body=%s", modelsResp.Body.String())
	}
}

func newEvalMux(service *Service) *http.ServeMux {
	mux := http.NewServeMux()
	protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
	RegisterHTTPRoutes(mux, service, protected)
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

type memoryControlStore struct {
	evaluators map[string]evalpkg.EvaluatorDefinition
	rules      map[string]evalpkg.RuleDefinition
}

func newMemoryControlStore() *memoryControlStore {
	return &memoryControlStore{
		evaluators: map[string]evalpkg.EvaluatorDefinition{},
		rules:      map[string]evalpkg.RuleDefinition{},
	}
}

func (s *memoryControlStore) CreateEvaluator(_ context.Context, evaluator evalpkg.EvaluatorDefinition) error {
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
