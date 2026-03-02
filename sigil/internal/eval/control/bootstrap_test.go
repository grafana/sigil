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
