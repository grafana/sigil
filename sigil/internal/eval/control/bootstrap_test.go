package control

import (
	"context"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/predefined"
)

func TestBootstrapPredefinedTemplates(t *testing.T) {
	store := newMemoryTemplateStore()
	err := BootstrapPredefinedTemplates(context.Background(), store)
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	// All predefined templates should be created as global.
	allTemplates := predefined.Templates()
	templates, _, err := store.ListTemplates(context.Background(), "any-tenant", nil, 100, 0)
	if err != nil {
		t.Fatalf("list templates: %v", err)
	}

	globalCount := 0
	for _, tmpl := range templates {
		if tmpl.Scope == evalpkg.TemplateScopeGlobal {
			globalCount++
		}
	}
	if globalCount != len(allTemplates) {
		t.Errorf("expected %d global templates, got %d", len(allTemplates), globalCount)
	}

	// Verify a specific template.
	got, err := store.GetGlobalTemplate(context.Background(), "sigil.helpfulness")
	if err != nil {
		t.Fatalf("get sigil.helpfulness: %v", err)
	}
	if got == nil {
		t.Fatalf("expected sigil.helpfulness to exist")
	}
	if got.TemplateID != "sigil.helpfulness" {
		t.Errorf("expected template_id=sigil.helpfulness, got %q", got.TemplateID)
	}
	if got.Scope != evalpkg.TemplateScopeGlobal {
		t.Errorf("expected scope=global, got %q", got.Scope)
	}
	if got.TenantID != GlobalTenantID {
		t.Errorf("expected tenant_id=%q, got %q", GlobalTenantID, got.TenantID)
	}
	if got.Kind != evalpkg.EvaluatorKindLLMJudge {
		t.Errorf("expected kind=llm_judge, got %q", got.Kind)
	}
	if got.LatestVersion != predefined.DefaultTemplateVersion {
		t.Errorf("expected latest_version=%q, got %q", predefined.DefaultTemplateVersion, got.LatestVersion)
	}
	if got.Description == "" {
		t.Errorf("expected non-empty description for predefined template")
	}
	if got.CreatedAt.IsZero() {
		t.Errorf("expected non-zero CreatedAt for bootstrapped template")
	}
	if got.UpdatedAt.IsZero() {
		t.Errorf("expected non-zero UpdatedAt for bootstrapped template")
	}

	// Verify version was created alongside the template.
	ver, err := store.GetTemplateVersion(context.Background(), GlobalTenantID, "sigil.helpfulness", predefined.DefaultTemplateVersion)
	if err != nil {
		t.Fatalf("get version: %v", err)
	}
	if ver == nil {
		t.Fatalf("expected version to exist")
	}
	if ver.Changelog != "Predefined template" {
		t.Errorf("expected changelog=%q, got %q", "Predefined template", ver.Changelog)
	}
	if len(ver.Config) == 0 {
		t.Errorf("expected non-empty config")
	}
	if ver.CreatedAt.IsZero() {
		t.Errorf("expected non-zero CreatedAt for bootstrapped template version")
	}
	if len(ver.OutputKeys) != 1 {
		t.Errorf("expected 1 output key, got %d", len(ver.OutputKeys))
	} else if ver.OutputKeys[0].Key != "helpfulness" {
		t.Errorf("expected output key=helpfulness, got %q", ver.OutputKeys[0].Key)
	}

	// Idempotent: run again, same count.
	err = BootstrapPredefinedTemplates(context.Background(), store)
	if err != nil {
		t.Fatalf("idempotent bootstrap: %v", err)
	}

	templates2, _, err := store.ListTemplates(context.Background(), "any-tenant", nil, 100, 0)
	if err != nil {
		t.Fatalf("list templates after re-bootstrap: %v", err)
	}
	if len(templates2) != len(templates) {
		t.Errorf("expected idempotent count %d, got %d", len(templates), len(templates2))
	}
}

func TestBootstrapPredefinedTemplatesDeletesDeprecatedGlobals(t *testing.T) {
	store := newMemoryTemplateStore()
	ctx := context.Background()

	deprecated := evalpkg.TemplateDefinition{
		TenantID:      GlobalTenantID,
		TemplateID:    "sigil.hallucination",
		Scope:         evalpkg.TemplateScopeGlobal,
		LatestVersion: "2026-03-04",
		Kind:          evalpkg.EvaluatorKindLLMJudge,
		Description:   "Deprecated hallucination template",
	}
	version := evalpkg.TemplateVersion{
		TenantID:   GlobalTenantID,
		TemplateID: "sigil.hallucination",
		Version:    "2026-03-04",
		Config:     map[string]any{"max_tokens": 256, "temperature": 0.0},
		OutputKeys: []evalpkg.OutputKey{{Key: "hallucination", Type: evalpkg.ScoreTypeNumber}},
	}
	if err := store.CreateTemplate(ctx, deprecated, version); err != nil {
		t.Fatalf("create deprecated template: %v", err)
	}

	if err := BootstrapPredefinedTemplates(ctx, store); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	gotDeprecated, err := store.GetGlobalTemplate(context.Background(), "sigil.hallucination")
	if err != nil {
		t.Fatalf("get deprecated template: %v", err)
	}
	if gotDeprecated != nil {
		t.Fatal("expected deprecated global template to be removed")
	}

	gotGroundedness, err := store.GetGlobalTemplate(context.Background(), "sigil.groundedness")
	if err != nil {
		t.Fatalf("get groundedness template: %v", err)
	}
	if gotGroundedness == nil {
		t.Fatal("expected groundedness global template to be created")
	}
}

type bootstrapNotFoundDeleteStore struct {
	*memoryTemplateStore
}

func (s *bootstrapNotFoundDeleteStore) DeleteTemplate(_ context.Context, tenantID, templateID string) error {
	if tenantID == GlobalTenantID && templateID == "sigil.hallucination" {
		return evalpkg.ErrNotFound
	}
	return s.memoryTemplateStore.DeleteTemplate(context.Background(), tenantID, templateID)
}

func TestBootstrapPredefinedTemplatesIgnoresMissingDeprecatedGlobals(t *testing.T) {
	store := &bootstrapNotFoundDeleteStore{memoryTemplateStore: newMemoryTemplateStore()}

	if err := BootstrapPredefinedTemplates(context.Background(), store); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	got, err := store.GetGlobalTemplate(context.Background(), "sigil.groundedness")
	if err != nil {
		t.Fatalf("get groundedness template: %v", err)
	}
	if got == nil {
		t.Fatal("expected groundedness global template to be created")
	}
}
