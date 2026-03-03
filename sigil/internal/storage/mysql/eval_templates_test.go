package mysql

import (
	"context"
	"errors"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestTemplateStoreCRUD(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	// Create template with initial version.
	err := store.CreateTemplate(context.Background(), evalpkg.TemplateDefinition{
		TenantID:      "tenant-a",
		TemplateID:    "tmpl.helpfulness",
		Scope:         evalpkg.TemplateScopeTenant,
		LatestVersion: "v1",
		Kind:          evalpkg.EvaluatorKindLLMJudge,
		Description:   "Helpfulness evaluator template",
	}, evalpkg.TemplateVersion{
		TenantID:   "tenant-a",
		TemplateID: "tmpl.helpfulness",
		Version:    "v1",
		Config: map[string]any{
			"provider":      "openai",
			"model":         "gpt-4o-mini",
			"system_prompt": "score this response for helpfulness",
		},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
		Changelog:  "Initial version",
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	// GetTemplate
	tmpl, err := store.GetTemplate(context.Background(), "tenant-a", "tmpl.helpfulness")
	if err != nil {
		t.Fatalf("get template: %v", err)
	}
	if tmpl == nil {
		t.Fatal("expected template to exist")
	}
	if tmpl.Kind != evalpkg.EvaluatorKindLLMJudge {
		t.Errorf("unexpected kind %q", tmpl.Kind)
	}
	if tmpl.LatestVersion != "v1" {
		t.Errorf("unexpected latest version %q", tmpl.LatestVersion)
	}
	if tmpl.Description != "Helpfulness evaluator template" {
		t.Errorf("unexpected description %q", tmpl.Description)
	}
	if tmpl.Scope != evalpkg.TemplateScopeTenant {
		t.Errorf("unexpected scope %q", tmpl.Scope)
	}

	// ListTemplates returns the template.
	items, nextCursor, err := store.ListTemplates(context.Background(), "tenant-a", nil, 10, 0)
	if err != nil {
		t.Fatalf("list templates: %v", err)
	}
	if nextCursor != 0 {
		t.Errorf("expected next cursor 0, got %d", nextCursor)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 template, got %d", len(items))
	}

	// GetTemplateVersion
	ver, err := store.GetTemplateVersion(context.Background(), "tenant-a", "tmpl.helpfulness", "v1")
	if err != nil {
		t.Fatalf("get template version: %v", err)
	}
	if ver == nil {
		t.Fatal("expected version to exist")
	}
	if ver.Config["provider"] != "openai" {
		t.Errorf("unexpected config %#v", ver.Config)
	}
	if len(ver.OutputKeys) != 1 || ver.OutputKeys[0].Key != "helpfulness" {
		t.Errorf("unexpected output keys %#v", ver.OutputKeys)
	}
	if ver.Changelog != "Initial version" {
		t.Errorf("unexpected changelog %q", ver.Changelog)
	}

	// GetLatestTemplateVersion
	latest, err := store.GetLatestTemplateVersion(context.Background(), "tenant-a", "tmpl.helpfulness")
	if err != nil {
		t.Fatalf("get latest template version: %v", err)
	}
	if latest == nil {
		t.Fatal("expected latest version to exist")
	}
	if latest.Version != "v1" {
		t.Errorf("unexpected latest version %q", latest.Version)
	}

	// Publish a new version.
	err = store.CreateTemplateVersion(context.Background(), evalpkg.TemplateVersion{
		TenantID:   "tenant-a",
		TemplateID: "tmpl.helpfulness",
		Version:    "v2",
		Config: map[string]any{
			"provider":      "openai",
			"model":         "gpt-4o",
			"system_prompt": "improved helpfulness prompt",
		},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
		Changelog:  "Upgraded model",
	})
	if err != nil {
		t.Fatalf("create template version v2: %v", err)
	}

	// Update latest version pointer.
	err = store.UpdateTemplateLatestVersion(context.Background(), "tenant-a", "tmpl.helpfulness", "v2")
	if err != nil {
		t.Fatalf("update template latest version: %v", err)
	}

	// Verify latest version is now v2.
	latest, err = store.GetLatestTemplateVersion(context.Background(), "tenant-a", "tmpl.helpfulness")
	if err != nil {
		t.Fatalf("get latest template version after update: %v", err)
	}
	if latest == nil {
		t.Fatal("expected latest version to exist after update")
	}
	if latest.Version != "v2" {
		t.Errorf("expected latest version v2, got %q", latest.Version)
	}

	// ListTemplateVersions returns both versions, newest first.
	versions, err := store.ListTemplateVersions(context.Background(), "tenant-a", "tmpl.helpfulness")
	if err != nil {
		t.Fatalf("list template versions: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("expected 2 versions, got %d", len(versions))
	}
	if versions[0].Version != "v2" {
		t.Errorf("expected first version to be v2 (newest), got %q", versions[0].Version)
	}

	// CountActiveTemplates
	count, err := store.CountActiveTemplates(context.Background(), "tenant-a")
	if err != nil {
		t.Fatalf("count active templates: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 active template, got %d", count)
	}

	// Soft delete.
	if err := store.DeleteTemplate(context.Background(), "tenant-a", "tmpl.helpfulness"); err != nil {
		t.Fatalf("delete template: %v", err)
	}

	// Idempotent delete.
	if err := store.DeleteTemplate(context.Background(), "tenant-a", "tmpl.helpfulness"); err != nil {
		t.Fatalf("idempotent delete template: %v", err)
	}

	// Verify deleted.
	tmpl, err = store.GetTemplate(context.Background(), "tenant-a", "tmpl.helpfulness")
	if err != nil {
		t.Fatalf("get template after delete: %v", err)
	}
	if tmpl != nil {
		t.Error("expected template to be deleted")
	}

	// Count should be 0 after delete.
	count, err = store.CountActiveTemplates(context.Background(), "tenant-a")
	if err != nil {
		t.Fatalf("count active templates after delete: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 active templates after delete, got %d", count)
	}
}

func TestTemplateStoreGlobalVisibility(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	// Create a global template.
	err := store.CreateTemplate(context.Background(), evalpkg.TemplateDefinition{
		TenantID:      evalpkg.GlobalTenantID,
		TemplateID:    "tmpl.global-safety",
		Scope:         evalpkg.TemplateScopeGlobal,
		LatestVersion: "v1",
		Kind:          evalpkg.EvaluatorKindLLMJudge,
		Description:   "Global safety evaluator",
	}, evalpkg.TemplateVersion{
		TenantID:   evalpkg.GlobalTenantID,
		TemplateID: "tmpl.global-safety",
		Version:    "v1",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o"},
		OutputKeys: []evalpkg.OutputKey{{Key: "safety", Type: evalpkg.ScoreTypeBool}},
	})
	if err != nil {
		t.Fatalf("create global template: %v", err)
	}

	// Create a tenant-scoped template.
	err = store.CreateTemplate(context.Background(), evalpkg.TemplateDefinition{
		TenantID:      "tenant-b",
		TemplateID:    "tmpl.tenant-quality",
		Scope:         evalpkg.TemplateScopeTenant,
		LatestVersion: "v1",
		Kind:          evalpkg.EvaluatorKindLLMJudge,
	}, evalpkg.TemplateVersion{
		TenantID:   "tenant-b",
		TemplateID: "tmpl.tenant-quality",
		Version:    "v1",
		Config:     map[string]any{"provider": "anthropic"},
		OutputKeys: []evalpkg.OutputKey{{Key: "quality", Type: evalpkg.ScoreTypeNumber}},
	})
	if err != nil {
		t.Fatalf("create tenant template: %v", err)
	}

	// Listing from tenant-b should see both the global and tenant template.
	items, _, err := store.ListTemplates(context.Background(), "tenant-b", nil, 50, 0)
	if err != nil {
		t.Fatalf("list templates from tenant-b: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 templates (global + tenant), got %d", len(items))
	}

	// Listing from tenant-c (no templates of its own) should see the global template.
	items, _, err = store.ListTemplates(context.Background(), "tenant-c", nil, 50, 0)
	if err != nil {
		t.Fatalf("list templates from tenant-c: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 global template for tenant-c, got %d", len(items))
	}
	if items[0].TemplateID != "tmpl.global-safety" {
		t.Errorf("expected global template, got %q", items[0].TemplateID)
	}

	// GetGlobalTemplate should find it.
	global, err := store.GetGlobalTemplate(context.Background(), "tmpl.global-safety")
	if err != nil {
		t.Fatalf("get global template: %v", err)
	}
	if global == nil {
		t.Fatal("expected global template to exist")
	}
	if global.TenantID != evalpkg.GlobalTenantID {
		t.Errorf("expected tenant_id %q, got %q", evalpkg.GlobalTenantID, global.TenantID)
	}

	// GetGlobalTemplate should not find tenant templates.
	notGlobal, err := store.GetGlobalTemplate(context.Background(), "tmpl.tenant-quality")
	if err != nil {
		t.Fatalf("get global template for tenant template: %v", err)
	}
	if notGlobal != nil {
		t.Error("expected tenant template to not be found via GetGlobalTemplate")
	}

	// CountActiveTemplates counts tenant-only, not global.
	count, err := store.CountActiveTemplates(context.Background(), "tenant-b")
	if err != nil {
		t.Fatalf("count active templates tenant-b: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 tenant template, got %d", count)
	}
}

func TestTemplateStoreScopeFilter(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	// Create a global template.
	err := store.CreateTemplate(context.Background(), evalpkg.TemplateDefinition{
		TenantID:      evalpkg.GlobalTenantID,
		TemplateID:    "tmpl.global-one",
		Scope:         evalpkg.TemplateScopeGlobal,
		LatestVersion: "v1",
		Kind:          evalpkg.EvaluatorKindLLMJudge,
	}, evalpkg.TemplateVersion{
		TenantID:   evalpkg.GlobalTenantID,
		TemplateID: "tmpl.global-one",
		Version:    "v1",
		Config:     map[string]any{},
		OutputKeys: []evalpkg.OutputKey{},
	})
	if err != nil {
		t.Fatalf("create global template: %v", err)
	}

	// Create a tenant template.
	err = store.CreateTemplate(context.Background(), evalpkg.TemplateDefinition{
		TenantID:      "tenant-d",
		TemplateID:    "tmpl.tenant-one",
		Scope:         evalpkg.TemplateScopeTenant,
		LatestVersion: "v1",
		Kind:          evalpkg.EvaluatorKindRegex,
	}, evalpkg.TemplateVersion{
		TenantID:   "tenant-d",
		TemplateID: "tmpl.tenant-one",
		Version:    "v1",
		Config:     map[string]any{},
		OutputKeys: []evalpkg.OutputKey{},
	})
	if err != nil {
		t.Fatalf("create tenant template: %v", err)
	}

	// Filter by scope=tenant should exclude global.
	tenantScope := evalpkg.TemplateScopeTenant
	items, _, err := store.ListTemplates(context.Background(), "tenant-d", &tenantScope, 50, 0)
	if err != nil {
		t.Fatalf("list templates with tenant scope: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 tenant-scoped template, got %d", len(items))
	}
	if items[0].TemplateID != "tmpl.tenant-one" {
		t.Errorf("expected tenant template, got %q", items[0].TemplateID)
	}

	// Filter by scope=global should exclude tenant.
	globalScope := evalpkg.TemplateScopeGlobal
	items, _, err = store.ListTemplates(context.Background(), "tenant-d", &globalScope, 50, 0)
	if err != nil {
		t.Fatalf("list templates with global scope: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 global-scoped template, got %d", len(items))
	}
	if items[0].TemplateID != "tmpl.global-one" {
		t.Errorf("expected global template, got %q", items[0].TemplateID)
	}
}

func TestTemplateStoreDuplicateTemplateID(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	err := store.CreateTemplate(context.Background(), evalpkg.TemplateDefinition{
		TenantID:      "tenant-e",
		TemplateID:    "tmpl.dup",
		Scope:         evalpkg.TemplateScopeTenant,
		LatestVersion: "v1",
		Kind:          evalpkg.EvaluatorKindLLMJudge,
	}, evalpkg.TemplateVersion{
		TenantID:   "tenant-e",
		TemplateID: "tmpl.dup",
		Version:    "v1",
		Config:     map[string]any{},
		OutputKeys: []evalpkg.OutputKey{},
	})
	if err != nil {
		t.Fatalf("create first template: %v", err)
	}

	// Same tenant_id + template_id should fail.
	err = store.CreateTemplate(context.Background(), evalpkg.TemplateDefinition{
		TenantID:      "tenant-e",
		TemplateID:    "tmpl.dup",
		Scope:         evalpkg.TemplateScopeTenant,
		LatestVersion: "v2",
		Kind:          evalpkg.EvaluatorKindLLMJudge,
	}, evalpkg.TemplateVersion{
		TenantID:   "tenant-e",
		TemplateID: "tmpl.dup",
		Version:    "v2",
		Config:     map[string]any{},
		OutputKeys: []evalpkg.OutputKey{},
	})
	if err == nil {
		t.Fatal("expected error for duplicate template ID")
	}
}

func TestTemplateStoreDuplicateVersion(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	err := store.CreateTemplate(context.Background(), evalpkg.TemplateDefinition{
		TenantID:      "tenant-f",
		TemplateID:    "tmpl.verdup",
		Scope:         evalpkg.TemplateScopeTenant,
		LatestVersion: "v1",
		Kind:          evalpkg.EvaluatorKindLLMJudge,
	}, evalpkg.TemplateVersion{
		TenantID:   "tenant-f",
		TemplateID: "tmpl.verdup",
		Version:    "v1",
		Config:     map[string]any{},
		OutputKeys: []evalpkg.OutputKey{},
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	// Same tenant_id + template_id + version should fail.
	err = store.CreateTemplateVersion(context.Background(), evalpkg.TemplateVersion{
		TenantID:   "tenant-f",
		TemplateID: "tmpl.verdup",
		Version:    "v1",
		Config:     map[string]any{"different": true},
		OutputKeys: []evalpkg.OutputKey{},
	})
	if err == nil {
		t.Fatal("expected error for duplicate version")
	}
}

func TestTemplateStoreDeleteNonexistent(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	// Deleting a template that doesn't exist should not error.
	err := store.DeleteTemplate(context.Background(), "tenant-g", "tmpl.nonexistent")
	if err != nil {
		t.Fatalf("delete nonexistent template should be idempotent: %v", err)
	}
}

func TestTemplateStoreUpdateLatestVersionNotFound(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	// Updating latest version on a nonexistent template should return ErrNotFound.
	err := store.UpdateTemplateLatestVersion(context.Background(), "tenant-h", "tmpl.missing", "v1")
	if err == nil {
		t.Fatal("expected error for update on nonexistent template")
	}
	if !errors.Is(err, evalpkg.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}
