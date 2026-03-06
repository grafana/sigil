package control

import (
	"context"
	"errors"
	"fmt"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/predefined"
)

// GlobalTenantID is the sentinel tenant ID for global-scope templates.
const GlobalTenantID = evalpkg.GlobalTenantID

// BootstrapPredefinedTemplates seeds the predefined templates into the templates table.
// Idempotent: creates templates that don't exist, and publishes new versions for
// templates that exist but don't yet have the current predefined version.
func BootstrapPredefinedTemplates(ctx context.Context, store evalpkg.TemplateStore) error {
	for _, templateID := range predefined.DeprecatedTemplateIDs() {
		if err := store.DeleteTemplate(ctx, GlobalTenantID, templateID); err != nil && !errors.Is(err, evalpkg.ErrNotFound) {
			return fmt.Errorf("delete deprecated template %s: %w", templateID, err)
		}
	}

	for _, def := range predefined.Templates() {
		existing, err := store.GetGlobalTemplate(ctx, def.EvaluatorID)
		if err != nil {
			return fmt.Errorf("check existing template %s: %w", def.EvaluatorID, err)
		}

		now := time.Now().UTC()

		if existing == nil {
			// First time: create template + initial version.
			tmpl := evalpkg.TemplateDefinition{
				TenantID:      GlobalTenantID,
				TemplateID:    def.EvaluatorID,
				Scope:         evalpkg.TemplateScopeGlobal,
				LatestVersion: def.Version,
				Kind:          def.Kind,
				Description:   def.Description,
				CreatedAt:     now,
				UpdatedAt:     now,
			}
			version := evalpkg.TemplateVersion{
				TenantID:   GlobalTenantID,
				TemplateID: def.EvaluatorID,
				Version:    def.Version,
				Config:     def.Config,
				OutputKeys: def.OutputKeys,
				Changelog:  "Predefined template",
				CreatedAt:  now,
			}
			if err := store.CreateTemplate(ctx, tmpl, version); err != nil {
				return fmt.Errorf("bootstrap template %s: %w", def.EvaluatorID, err)
			}
			continue
		}

		// Template exists: check whether the current predefined version is present.
		ver, err := store.GetTemplateVersion(ctx, GlobalTenantID, def.EvaluatorID, def.Version)
		if err != nil {
			return fmt.Errorf("check version %s for template %s: %w", def.Version, def.EvaluatorID, err)
		}
		if ver == nil {
			// New predefined version not yet in DB: publish it.
			version := evalpkg.TemplateVersion{
				TenantID:   GlobalTenantID,
				TemplateID: def.EvaluatorID,
				Version:    def.Version,
				Config:     def.Config,
				OutputKeys: def.OutputKeys,
				Changelog:  "Predefined template update",
				CreatedAt:  now,
			}
			if err := store.CreateTemplateVersion(ctx, version); err != nil {
				return fmt.Errorf("bootstrap new version %s for template %s: %w", def.Version, def.EvaluatorID, err)
			}
		}

		// Ensure latest_version points at the current predefined version.
		if existing.LatestVersion != def.Version {
			if err := store.UpdateTemplateLatestVersion(ctx, GlobalTenantID, def.EvaluatorID, def.Version); err != nil {
				return fmt.Errorf("update latest version for template %s: %w", def.EvaluatorID, err)
			}
		}

		// Sync description in case it changed between releases.
		if existing.Description != def.Description {
			if err := store.UpdateTemplateDescription(ctx, GlobalTenantID, def.EvaluatorID, def.Description); err != nil {
				return fmt.Errorf("update description for template %s: %w", def.EvaluatorID, err)
			}
		}
	}
	return nil
}
