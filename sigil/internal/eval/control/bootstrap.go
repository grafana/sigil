package control

import (
	"context"
	"fmt"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/predefined"
)

// GlobalTenantID is the sentinel tenant ID for global-scope templates.
const GlobalTenantID = evalpkg.GlobalTenantID

// BootstrapPredefinedTemplates seeds the predefined templates into the templates table.
// Idempotent: skips templates that already exist.
func BootstrapPredefinedTemplates(ctx context.Context, store evalpkg.TemplateStore) error {
	for _, def := range predefined.Templates() {
		// Check if already exists.
		existing, err := store.GetGlobalTemplate(ctx, def.EvaluatorID)
		if err != nil {
			return fmt.Errorf("check existing template %s: %w", def.EvaluatorID, err)
		}
		if existing != nil {
			continue
		}

		now := time.Now().UTC()
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
	}
	return nil
}
