package control

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/predefined"
)

func newTemplateTestEnv(t *testing.T) (*TemplateService, *memoryTemplateStore, *memoryControlStore) {
	t.Helper()
	ts := newMemoryTemplateStore()
	cs := newMemoryControlStore()
	evalSvc := NewService(cs, nil)
	return NewTemplateService(ts, evalSvc), ts, cs
}

func TestTemplateService_Create(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	tmpl, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID:  "my_template",
		Kind:        "llm_judge",
		Description: "A test template",
		Version:     "2026-03-01",
		Config:      map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
		Changelog:   "initial version",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if tmpl.Scope != evalpkg.TemplateScopeTenant {
		t.Errorf("expected scope=tenant, got %q", tmpl.Scope)
	}
	if tmpl.LatestVersion != "2026-03-01" {
		t.Errorf("expected latest_version=2026-03-01, got %q", tmpl.LatestVersion)
	}
	if tmpl.TemplateID != "my_template" {
		t.Errorf("expected template_id=my_template, got %q", tmpl.TemplateID)
	}
	if tmpl.TenantID != "tenant_1" {
		t.Errorf("expected tenant_id=tenant_1, got %q", tmpl.TenantID)
	}
}

func TestTemplateService_Create_InvalidKind(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "my_template",
		Kind:       "unknown_kind",
		Version:    "2026-03-01",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
		OutputKeys: []evalpkg.OutputKey{{Key: "score", Type: evalpkg.ScoreTypeNumber}},
	})
	if err == nil {
		t.Fatal("expected validation error for invalid kind")
	}
	if !isValidationError(err) {
		t.Errorf("expected validation error, got %v", err)
	}
	if !strings.Contains(err.Error(), "kind is invalid") {
		t.Errorf("expected 'kind is invalid' in error, got %q", err.Error())
	}
}

func TestTemplateService_Create_InvalidVersion(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	testCases := []struct {
		name    string
		version string
	}{
		{name: "not_a_date", version: "v1.0.0"},
		{name: "missing_day", version: "2026-03"},
		{name: "bad_suffix", version: "2026-03-01.abc"},
		{name: "negative_suffix", version: "2026-03-01.-1"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
				TemplateID: "my_template",
				Kind:       "llm_judge",
				Version:    tc.version,
				Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
				OutputKeys: []evalpkg.OutputKey{{Key: "score", Type: evalpkg.ScoreTypeNumber}},
			})
			if err == nil {
				t.Fatalf("expected validation error for version %q", tc.version)
			}
			if !isValidationError(err) {
				t.Errorf("expected validation error, got %v", err)
			}
			if !strings.Contains(err.Error(), "YYYY-MM-DD") {
				t.Errorf("expected version format error, got %q", err.Error())
			}
		})
	}
}

func TestTemplateService_Create_MissingFields(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	testCases := []struct {
		name    string
		req     CreateTemplateRequest
		wantErr string
	}{
		{
			name: "missing_template_id",
			req: CreateTemplateRequest{
				Kind:       "llm_judge",
				Version:    "2026-03-01",
				Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
				OutputKeys: []evalpkg.OutputKey{{Key: "score", Type: evalpkg.ScoreTypeNumber}},
			},
			wantErr: "template_id is required",
		},
		{
			name: "missing_config",
			req: CreateTemplateRequest{
				TemplateID: "my_template",
				Kind:       "llm_judge",
				Version:    "2026-03-01",
				Config:     nil,
				OutputKeys: []evalpkg.OutputKey{{Key: "score", Type: evalpkg.ScoreTypeNumber}},
			},
			wantErr: "config is required",
		},
		{
			name: "missing_output_keys",
			req: CreateTemplateRequest{
				TemplateID: "my_template",
				Kind:       "llm_judge",
				Version:    "2026-03-01",
				Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
				OutputKeys: nil,
			},
			wantErr: "output_keys must include exactly one key",
		},
		{
			name: "multiple_output_keys",
			req: CreateTemplateRequest{
				TemplateID: "my_template",
				Kind:       "llm_judge",
				Version:    "2026-03-01",
				Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
				OutputKeys: []evalpkg.OutputKey{
					{Key: "a", Type: evalpkg.ScoreTypeNumber},
					{Key: "b", Type: evalpkg.ScoreTypeNumber},
				},
			},
			wantErr: "output_keys must include exactly one key",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.CreateTemplate(context.Background(), "tenant_1", tc.req)
			if err == nil {
				t.Fatal("expected validation error")
			}
			if !isValidationError(err) {
				t.Errorf("expected validation error, got %v", err)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("expected error containing %q, got %q", tc.wantErr, err.Error())
			}
		})
	}
}

func TestTemplateService_PublishVersion(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "my_template",
		Kind:       "llm_judge",
		Version:    "2026-03-01",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	ver, err := svc.PublishVersion(context.Background(), "tenant_1", "my_template", PublishVersionRequest{
		Version:    "2026-03-02",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o"},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
		Changelog:  "added model",
	})
	if err != nil {
		t.Fatalf("publish version: %v", err)
	}
	if ver.Version != "2026-03-02" {
		t.Errorf("expected version 2026-03-02, got %q", ver.Version)
	}

	// Verify latest_version advanced.
	tmpl, latestVer, err := svc.GetTemplate(context.Background(), "tenant_1", "my_template")
	if err != nil {
		t.Fatalf("get template: %v", err)
	}
	if tmpl.LatestVersion != "2026-03-02" {
		t.Errorf("expected latest_version=2026-03-02, got %q", tmpl.LatestVersion)
	}
	if latestVer == nil || latestVer.Version != "2026-03-02" {
		t.Errorf("expected latest version to be 2026-03-02, got %v", latestVer)
	}
}

func TestTemplateService_PublishVersion_DuplicateVersion(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "my_template",
		Kind:       "llm_judge",
		Version:    "2026-03-01",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	_, err = svc.PublishVersion(context.Background(), "tenant_1", "my_template", PublishVersionRequest{
		Version:    "2026-03-01",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o"},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
	})
	if err == nil {
		t.Fatal("expected error for duplicate version")
	}
	if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("expected 'already exists' in error, got %q", err.Error())
	}
}

func TestTemplateService_CreateDuplicate(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "dup_template",
		Kind:       "llm_judge",
		Version:    "2026-03-01",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
		OutputKeys: []evalpkg.OutputKey{{Key: "score", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "dup_template",
		Kind:       "llm_judge",
		Version:    "2026-03-02",
		Config:     map[string]any{"provider": "anthropic", "model": "claude-3-5-haiku-latest"},
		OutputKeys: []evalpkg.OutputKey{{Key: "score", Type: evalpkg.ScoreTypeNumber}},
	})
	if err == nil {
		t.Fatal("expected error for duplicate template ID")
	}
	if !isConflictError(err) {
		t.Errorf("expected conflict error, got %v", err)
	}
	if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("expected 'already exists' in error, got %q", err.Error())
	}
}

func TestTemplateService_CreateTemplate_MapsStoreConflict(t *testing.T) {
	store := newMemoryTemplateStore()
	store.createErr = fmt.Errorf("%w: template %q already exists", evalpkg.ErrConflict, "dup_template")
	svc := NewTemplateService(store, nil)

	_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "dup_template",
		Kind:       "llm_judge",
		Version:    "2026-03-01",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
		OutputKeys: []evalpkg.OutputKey{{Key: "score", Type: evalpkg.ScoreTypeNumber}},
	})
	if err == nil {
		t.Fatal("expected conflict error")
	}
	if !isConflictError(err) {
		t.Fatalf("expected conflict error, got %v", err)
	}
	if !strings.Contains(err.Error(), "template \"dup_template\" already exists") {
		t.Fatalf("unexpected conflict error: %v", err)
	}
}

func TestTemplateService_ForkTemplate(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "my_template",
		Kind:       "llm_judge",
		Version:    "2026-03-01",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	eval, err := svc.ForkTemplate(context.Background(), "tenant_1", "my_template", ForkTemplateRequest{
		EvaluatorID: "custom.helpfulness",
	})
	if err != nil {
		t.Fatalf("fork template: %v", err)
	}
	if eval.EvaluatorID != "custom.helpfulness" {
		t.Errorf("expected evaluator_id=custom.helpfulness, got %q", eval.EvaluatorID)
	}
	if eval.SourceTemplateID != "my_template" {
		t.Errorf("expected source_template_id=my_template, got %q", eval.SourceTemplateID)
	}
	if eval.SourceTemplateVersion != "2026-03-01" {
		t.Errorf("expected source_template_version=2026-03-01, got %q", eval.SourceTemplateVersion)
	}
	if eval.Kind != evalpkg.EvaluatorKindLLMJudge {
		t.Errorf("expected kind=llm_judge, got %q", eval.Kind)
	}
	if eval.Config["provider"] != "openai" {
		t.Errorf("expected config.provider=openai, got %v", eval.Config["provider"])
	}
}

func TestTemplateService_ForkTemplate_WithOverrides(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "my_template",
		Kind:       "llm_judge",
		Version:    "2026-03-01",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini", "temperature": 0.5},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	eval, err := svc.ForkTemplate(context.Background(), "tenant_1", "my_template", ForkTemplateRequest{
		EvaluatorID: "custom.helpfulness",
		Config:      map[string]any{"provider": "google", "model": "gemini-2.0-flash"},
		OutputKeys:  []evalpkg.OutputKey{{Key: "quality", Type: evalpkg.ScoreTypeBool}},
	})
	if err != nil {
		t.Fatalf("fork template: %v", err)
	}

	// Overrides should be shallow-merged.
	if eval.Config["provider"] != "google" {
		t.Errorf("expected config.provider=google, got %v", eval.Config["provider"])
	}
	if eval.Config["model"] != "gemini-2.0-flash" {
		t.Errorf("expected config.model=gemini-2.0-flash, got %v", eval.Config["model"])
	}
	// Original key not overridden should remain.
	if eval.Config["temperature"] != 0.5 {
		t.Errorf("expected config.temperature=0.5, got %v", eval.Config["temperature"])
	}
	// Output keys should be replaced by request.
	if len(eval.OutputKeys) != 1 || eval.OutputKeys[0].Key != "quality" {
		t.Errorf("expected output_keys=[quality], got %v", eval.OutputKeys)
	}
}

func TestTemplateService_ForkTemplate_RejectsPartialLLMJudgeOverride(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "my_template",
		Kind:       "llm_judge",
		Version:    "2026-03-01",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	_, err = svc.ForkTemplate(context.Background(), "tenant_1", "my_template", ForkTemplateRequest{
		EvaluatorID: "custom.helpfulness",
		Config:      map[string]any{"provider": "anthropic"},
	})
	if err == nil {
		t.Fatal("expected validation error for partial llm_judge override")
	}
	if !isValidationError(err) {
		t.Fatalf("expected validation error, got %v", err)
	}
	if !strings.Contains(err.Error(), "requires both provider and model") {
		t.Fatalf("expected provider/model validation error, got %q", err.Error())
	}
}

func TestTemplateService_ForkTemplate_AllowsFullyQualifiedModelOverrideWithoutProvider(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "my_template",
		Kind:       "llm_judge",
		Version:    "2026-03-01",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini", "temperature": 0.5},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	eval, err := svc.ForkTemplate(context.Background(), "tenant_1", "my_template", ForkTemplateRequest{
		EvaluatorID: "custom.helpfulness",
		Config:      map[string]any{"model": "anthropic/claude-3-5-haiku-latest"},
	})
	if err != nil {
		t.Fatalf("fork template: %v", err)
	}
	if provider, ok := eval.Config["provider"]; ok {
		t.Fatalf("expected inherited provider to be cleared, got %v", provider)
	}
	if eval.Config["model"] != "anthropic/claude-3-5-haiku-latest" {
		t.Fatalf("expected fully-qualified model override, got %v", eval.Config["model"])
	}
	if eval.Config["temperature"] != 0.5 {
		t.Fatalf("expected unrelated config to remain, got %v", eval.Config["temperature"])
	}
}

func TestTemplateService_ForkTemplate_NotFound(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	_, err := svc.ForkTemplate(context.Background(), "tenant_1", "nonexistent", ForkTemplateRequest{
		EvaluatorID: "custom.helpfulness",
	})
	if err == nil {
		t.Fatal("expected error for fork nonexistent template")
	}
	if !isNotFoundError(err) {
		t.Errorf("expected not-found error, got %v", err)
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected 'not found' in error, got %q", err.Error())
	}
}

func TestTemplateService_DeleteTemplate(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
		TemplateID: "my_template",
		Kind:       "heuristic",
		Version:    "2026-03-01",
		Config:     map[string]any{"not_empty": true},
		OutputKeys: []evalpkg.OutputKey{{Key: "score", Type: evalpkg.ScoreTypeBool}},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	if err := svc.DeleteTemplate(context.Background(), "tenant_1", "my_template"); err != nil {
		t.Fatalf("delete template: %v", err)
	}

	// Verify template is no longer returned.
	tmpl, _, err := svc.GetTemplate(context.Background(), "tenant_1", "my_template")
	if err != nil {
		t.Fatalf("get template after delete: %v", err)
	}
	if tmpl != nil {
		t.Error("expected nil template after delete")
	}
}

func TestTemplateService_DeleteTemplate_Global(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	err := svc.DeleteTemplate(context.Background(), "tenant_1", "sigil.helpfulness")
	if err == nil {
		t.Fatal("expected error when deleting global template")
	}
	if !isValidationError(err) {
		t.Errorf("expected validation error, got %v", err)
	}
	if !strings.Contains(err.Error(), "cannot delete global templates") {
		t.Errorf("expected 'cannot delete global templates' in error, got %q", err.Error())
	}
}

func TestTemplateService_List(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	for _, id := range []string{"tenant_template_a", "tenant_template_b"} {
		_, err := svc.CreateTemplate(context.Background(), "tenant_1", CreateTemplateRequest{
			TemplateID: id,
			Kind:       "heuristic",
			Version:    "2026-03-01",
			Config:     map[string]any{"not_empty": true},
			OutputKeys: []evalpkg.OutputKey{{Key: "score", Type: evalpkg.ScoreTypeBool}},
		})
		if err != nil {
			t.Fatalf("create tenant template %s: %v", id, err)
		}
	}

	items, _, err := svc.ListTemplates(context.Background(), "tenant_1", nil, 50, 0)
	if err != nil {
		t.Fatalf("list templates: %v", err)
	}
	if len(items) < 3 {
		t.Fatalf("expected tenant templates plus predefined globals, got %d", len(items))
	}

	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.TemplateID)
	}
	sort.Strings(ids)
	if !slices.Contains(ids, "tenant_template_a") || !slices.Contains(ids, "tenant_template_b") {
		t.Errorf("expected tenant templates in list, got %v", ids)
	}
	if !slices.Contains(ids, "sigil.helpfulness") {
		t.Errorf("expected predefined global template in list, got %v", ids)
	}
}

func TestTemplateService_Get_PredefinedGlobal(t *testing.T) {
	svc, _, _ := newTemplateTestEnv(t)

	tmpl, ver, err := svc.GetTemplate(context.Background(), "tenant_1", "sigil.helpfulness")
	if err != nil {
		t.Fatalf("get template: %v", err)
	}
	if tmpl == nil {
		t.Fatal("expected predefined template to exist")
	}
	if tmpl.Scope != evalpkg.TemplateScopeGlobal {
		t.Errorf("expected scope=global, got %q", tmpl.Scope)
	}
	if tmpl.TemplateID != "sigil.helpfulness" {
		t.Errorf("expected sigil.helpfulness, got %q", tmpl.TemplateID)
	}
	if ver == nil {
		t.Fatal("expected predefined template config to be returned")
	}
	if ver.Version != predefined.DefaultTemplateVersion {
		t.Errorf("expected version=%s, got %q", predefined.DefaultTemplateVersion, ver.Version)
	}
	if len(ver.Config) == 0 {
		t.Error("expected predefined config")
	}
}

// memoryTemplateStore implements evalpkg.TemplateStore for testing.
type memoryTemplateStore struct {
	templates       map[string]evalpkg.TemplateDefinition // key: tenantID|templateID
	versions        map[string]evalpkg.TemplateVersion    // key: tenantID|templateID|version
	createErr       error                                 // injected error for CreateTemplate
	getErr          error                                 // injected error for GetTemplate
	listErr         error                                 // injected error for ListTemplates
	listVersionsErr error                                 // injected error for ListTemplateVersions
}

func newMemoryTemplateStore() *memoryTemplateStore {
	return &memoryTemplateStore{
		templates: map[string]evalpkg.TemplateDefinition{},
		versions:  map[string]evalpkg.TemplateVersion{},
	}
}

func (s *memoryTemplateStore) CreateTemplate(_ context.Context, tmpl evalpkg.TemplateDefinition, version evalpkg.TemplateVersion) error {
	if s.createErr != nil {
		return s.createErr
	}
	key := templateKey(tmpl.TenantID, tmpl.TemplateID)
	if _, exists := s.templates[key]; exists {
		return errors.New("template already exists")
	}
	s.templates[key] = tmpl
	s.versions[versionKey(version.TenantID, version.TemplateID, version.Version)] = version
	return nil
}

func (s *memoryTemplateStore) GetTemplate(_ context.Context, tenantID, templateID string) (*evalpkg.TemplateDefinition, error) {
	if s.getErr != nil {
		return nil, s.getErr
	}
	tmpl, ok := s.templates[templateKey(tenantID, templateID)]
	if !ok || tmpl.DeletedAt != nil {
		return nil, nil
	}
	copied := tmpl
	return &copied, nil
}

func (s *memoryTemplateStore) ListTemplates(_ context.Context, tenantID string, scope *evalpkg.TemplateScope, limit int, cursor uint64) ([]evalpkg.TemplateDefinition, uint64, error) {
	if s.listErr != nil {
		return nil, 0, s.listErr
	}
	items := make([]evalpkg.TemplateDefinition, 0)
	for _, tmpl := range s.templates {
		if tmpl.DeletedAt != nil {
			continue
		}
		if tmpl.TenantID != tenantID {
			continue
		}
		if scope != nil && tmpl.Scope != *scope {
			continue
		}
		items = append(items, tmpl)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].TemplateID < items[j].TemplateID })
	return paginateTemplates(items, limit, cursor)
}

func (s *memoryTemplateStore) DeleteTemplate(_ context.Context, tenantID, templateID string) error {
	key := templateKey(tenantID, templateID)
	tmpl, ok := s.templates[key]
	if !ok {
		return nil
	}
	now := time.Now().UTC()
	tmpl.DeletedAt = &now
	tmpl.UpdatedAt = now
	s.templates[key] = tmpl

	// Hard-delete versions to match MySQL behavior.
	for k, ver := range s.versions {
		if ver.TenantID == tenantID && ver.TemplateID == templateID {
			delete(s.versions, k)
		}
	}
	return nil
}

func (s *memoryTemplateStore) CountActiveTemplates(_ context.Context, tenantID string) (int64, error) {
	count := int64(0)
	for _, tmpl := range s.templates {
		if tmpl.TenantID == tenantID && tmpl.DeletedAt == nil {
			count++
		}
	}
	return count, nil
}

func (s *memoryTemplateStore) CreateTemplateVersion(_ context.Context, version evalpkg.TemplateVersion) error {
	key := versionKey(version.TenantID, version.TemplateID, version.Version)
	if _, exists := s.versions[key]; exists {
		return errors.New("version already exists")
	}
	s.versions[key] = version
	return nil
}

func (s *memoryTemplateStore) GetTemplateVersion(_ context.Context, tenantID, templateID, version string) (*evalpkg.TemplateVersion, error) {
	ver, ok := s.versions[versionKey(tenantID, templateID, version)]
	if !ok {
		return nil, nil
	}
	copied := ver
	return &copied, nil
}

func (s *memoryTemplateStore) GetLatestTemplateVersion(_ context.Context, tenantID, templateID string) (*evalpkg.TemplateVersion, error) {
	// Find the template to determine the latest version.
	tmpl, ok := s.templates[templateKey(tenantID, templateID)]
	if !ok || tmpl.DeletedAt != nil {
		return nil, nil
	}
	ver, ok := s.versions[versionKey(tenantID, templateID, tmpl.LatestVersion)]
	if !ok {
		return nil, nil
	}
	copied := ver
	return &copied, nil
}

func (s *memoryTemplateStore) ListTemplateVersions(_ context.Context, tenantID, templateID string) ([]evalpkg.TemplateVersion, error) {
	if s.listVersionsErr != nil {
		return nil, s.listVersionsErr
	}
	items := make([]evalpkg.TemplateVersion, 0)
	for _, ver := range s.versions {
		if ver.TenantID == tenantID && ver.TemplateID == templateID {
			items = append(items, ver)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Version < items[j].Version })
	return items, nil
}

func (s *memoryTemplateStore) PublishTemplateVersion(_ context.Context, version evalpkg.TemplateVersion) error {
	key := versionKey(version.TenantID, version.TemplateID, version.Version)
	if _, exists := s.versions[key]; exists {
		return errors.New("version already exists")
	}
	s.versions[key] = version

	tmplKey := templateKey(version.TenantID, version.TemplateID)
	tmpl, ok := s.templates[tmplKey]
	if !ok || tmpl.DeletedAt != nil {
		return evalpkg.ErrNotFound
	}
	tmpl.LatestVersion = version.Version
	tmpl.UpdatedAt = time.Now().UTC()
	s.templates[tmplKey] = tmpl
	return nil
}

func (s *memoryTemplateStore) UpdateTemplateLatestVersion(_ context.Context, tenantID, templateID, version string) error {
	key := templateKey(tenantID, templateID)
	tmpl, ok := s.templates[key]
	if !ok || tmpl.DeletedAt != nil {
		return evalpkg.ErrNotFound
	}
	tmpl.LatestVersion = version
	tmpl.UpdatedAt = time.Now().UTC()
	s.templates[key] = tmpl
	return nil
}

func (s *memoryTemplateStore) UpdateTemplateDescription(_ context.Context, tenantID, templateID, description string) error {
	key := templateKey(tenantID, templateID)
	tmpl, ok := s.templates[key]
	if !ok || tmpl.DeletedAt != nil {
		return evalpkg.ErrNotFound
	}
	tmpl.Description = description
	tmpl.UpdatedAt = time.Now().UTC()
	s.templates[key] = tmpl
	return nil
}

func TestValidateOutputKeyConstraints(t *testing.T) {
	floatPtr := func(v float64) *float64 { return &v }

	tests := []struct {
		name    string
		key     evalpkg.OutputKey
		wantErr string
	}{
		{
			name: "number_with_valid_min_max",
			key: evalpkg.OutputKey{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  floatPtr(0),
				Max:  floatPtr(10),
			},
			wantErr: "",
		},
		{
			name: "number_with_min_greater_than_max",
			key: evalpkg.OutputKey{
				Key:  "score",
				Type: evalpkg.ScoreTypeNumber,
				Min:  floatPtr(10),
				Max:  floatPtr(5),
			},
			wantErr: "min (10) must be < max (5)",
		},
		{
			name: "bool_with_min_max_wrong_type",
			key: evalpkg.OutputKey{
				Key:  "flag",
				Type: evalpkg.ScoreTypeBool,
				Min:  floatPtr(0),
				Max:  floatPtr(1),
			},
			wantErr: "min/max are only valid for number types",
		},
		{
			name: "number_with_pass_match_wrong_type",
			key: evalpkg.OutputKey{
				Key:       "score",
				Type:      evalpkg.ScoreTypeNumber,
				PassMatch: []string{"good"},
			},
			wantErr: "pass_match is only valid for string types",
		},
		{
			name: "string_with_pass_match_valid",
			key: evalpkg.OutputKey{
				Key:       "severity",
				Type:      evalpkg.ScoreTypeString,
				PassMatch: []string{"none", "mild"},
			},
			wantErr: "",
		},
		{
			name: "string_with_pass_threshold_wrong_type",
			key: evalpkg.OutputKey{
				Key:           "severity",
				Type:          evalpkg.ScoreTypeString,
				PassThreshold: floatPtr(0.5),
			},
			wantErr: "pass_threshold is only valid for number types",
		},
		{
			name: "number_with_pass_threshold_valid",
			key: evalpkg.OutputKey{
				Key:           "score",
				Type:          evalpkg.ScoreTypeNumber,
				PassThreshold: floatPtr(7),
			},
			wantErr: "",
		},
		{
			name: "bool_no_constraints_valid",
			key: evalpkg.OutputKey{
				Key:  "flag",
				Type: evalpkg.ScoreTypeBool,
			},
			wantErr: "",
		},
		{
			name: "bool_with_pass_value_valid",
			key: evalpkg.OutputKey{
				Key:       "toxic",
				Type:      evalpkg.ScoreTypeBool,
				PassValue: func() *bool { v := false; return &v }(),
			},
			wantErr: "",
		},
		{
			name: "number_with_pass_value_wrong_type",
			key: evalpkg.OutputKey{
				Key:       "score",
				Type:      evalpkg.ScoreTypeNumber,
				PassValue: func() *bool { v := true; return &v }(),
			},
			wantErr: "pass_value is only valid for bool types",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateOutputKeyConstraints(tc.key)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got %q", tc.wantErr, err.Error())
			}
		})
	}
}

func templateKey(tenantID, templateID string) string {
	return tenantID + "|" + templateID
}

func versionKey(tenantID, templateID, version string) string {
	return tenantID + "|" + templateID + "|" + version
}

func paginateTemplates(items []evalpkg.TemplateDefinition, limit int, cursor uint64) ([]evalpkg.TemplateDefinition, uint64, error) {
	if limit <= 0 {
		limit = 50
	}
	start := int(cursor)
	if start >= len(items) {
		return []evalpkg.TemplateDefinition{}, 0, nil
	}
	end := start + limit
	if end > len(items) {
		end = len(items)
	}
	nextCursor := uint64(0)
	if end < len(items) {
		nextCursor = uint64(end)
	}
	return append([]evalpkg.TemplateDefinition(nil), items[start:end]...), nextCursor, nil
}
