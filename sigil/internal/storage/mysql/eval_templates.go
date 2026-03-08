package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var _ evalpkg.TemplateStore = (*WALStore)(nil)

func (s *WALStore) CreateTemplate(ctx context.Context, tmpl evalpkg.TemplateDefinition, version evalpkg.TemplateVersion) error {
	if strings.TrimSpace(tmpl.TenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(tmpl.TemplateID) == "" {
		return errors.New("template id is required")
	}
	if strings.TrimSpace(tmpl.LatestVersion) == "" {
		return errors.New("template latest version is required")
	}
	if strings.TrimSpace(string(tmpl.Kind)) == "" {
		return errors.New("template kind is required")
	}

	configJSON, err := marshalJSONField(version.Config)
	if err != nil {
		return fmt.Errorf("marshal template version config: %w", err)
	}
	outputKeysJSON, err := marshalJSONField(version.OutputKeys)
	if err != nil {
		return fmt.Errorf("marshal template version output keys: %w", err)
	}

	now := tmpl.CreatedAt
	if now.IsZero() {
		now = time.Now().UTC()
	}
	scope := string(tmpl.Scope)
	if strings.TrimSpace(scope) == "" {
		scope = string(evalpkg.TemplateScopeTenant)
	}

	tmplModel := EvalTemplateModel{
		TenantID:      strings.TrimSpace(tmpl.TenantID),
		TemplateID:    strings.TrimSpace(tmpl.TemplateID),
		Scope:         scope,
		LatestVersion: strings.TrimSpace(tmpl.LatestVersion),
		Kind:          string(tmpl.Kind),
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if desc := strings.TrimSpace(tmpl.Description); desc != "" {
		tmplModel.Description = &desc
	}

	verCreatedAt := version.CreatedAt
	if verCreatedAt.IsZero() {
		verCreatedAt = now
	}
	versionModel := EvalTemplateVersionModel{
		TenantID:       strings.TrimSpace(version.TenantID),
		TemplateID:     strings.TrimSpace(version.TemplateID),
		Version:        strings.TrimSpace(version.Version),
		ConfigJSON:     configJSON,
		OutputKeysJSON: outputKeysJSON,
		CreatedAt:      verCreatedAt,
	}
	if cl := strings.TrimSpace(version.Changelog); cl != "" {
		versionModel.Changelog = &cl
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Check if a non-deleted template with this ID already exists.
		var existing EvalTemplateModel
		err := tx.Where("tenant_id = ? AND template_id = ? AND deleted_at IS NULL",
			tmplModel.TenantID, tmplModel.TemplateID).First(&existing).Error
		if err == nil {
			return fmt.Errorf("template %q already exists", tmplModel.TemplateID)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("check existing template: %w", err)
		}

		// Use upsert to handle re-creating a soft-deleted template.
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "tenant_id"}, {Name: "template_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"scope":          tmplModel.Scope,
				"latest_version": tmplModel.LatestVersion,
				"kind":           tmplModel.Kind,
				"description":    tmplModel.Description,
				"deleted_at":     nil,
				"updated_at":     now,
			}),
		}).Create(&tmplModel).Error; err != nil {
			return fmt.Errorf("create template: %w", err)
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "tenant_id"}, {Name: "template_id"}, {Name: "version"}},
			DoUpdates: clause.Assignments(map[string]any{
				"config_json":      versionModel.ConfigJSON,
				"output_keys_json": versionModel.OutputKeysJSON,
				"changelog":        versionModel.Changelog,
				"created_at":       versionModel.CreatedAt,
			}),
		}).Create(&versionModel).Error; err != nil {
			return fmt.Errorf("create template version: %w", err)
		}
		return nil
	})
}

func (s *WALStore) GetTemplate(ctx context.Context, tenantID, templateID string) (*evalpkg.TemplateDefinition, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(templateID) == "" {
		return nil, errors.New("template id is required")
	}

	var row EvalTemplateModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND template_id = ? AND deleted_at IS NULL", tenantID, templateID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get template: %w", err)
	}

	out := modelToTemplate(row)
	return &out, nil
}

func (s *WALStore) ListTemplates(ctx context.Context, tenantID string, scope *evalpkg.TemplateScope, limit int, cursor uint64) ([]evalpkg.TemplateDefinition, uint64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, 0, errors.New("tenant id is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	query := s.db.WithContext(ctx).
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Order("id ASC").
		Limit(limit + 1)
	if cursor > 0 {
		query = query.Where("id > ?", cursor)
	}
	if scope != nil {
		query = query.Where("scope = ?", string(*scope))
	}

	var rows []EvalTemplateModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list templates: %w", err)
	}

	nextCursor := uint64(0)
	if len(rows) > limit {
		nextCursor = rows[limit-1].ID
		rows = rows[:limit]
	}

	out := make([]evalpkg.TemplateDefinition, 0, len(rows))
	for _, row := range rows {
		out = append(out, modelToTemplate(row))
	}
	return out, nextCursor, nil
}

func (s *WALStore) DeleteTemplate(ctx context.Context, tenantID, templateID string) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(templateID) == "" {
		return errors.New("template id is required")
	}

	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&EvalTemplateModel{}).
			Where("tenant_id = ? AND template_id = ? AND deleted_at IS NULL", tenantID, templateID).
			Updates(map[string]any{"deleted_at": now, "updated_at": now}).
			Error; err != nil {
			return fmt.Errorf("soft-delete template: %w", err)
		}
		if err := tx.Where("tenant_id = ? AND template_id = ?", tenantID, templateID).
			Delete(&EvalTemplateVersionModel{}).Error; err != nil {
			return fmt.Errorf("delete template versions: %w", err)
		}
		return nil
	})
}

func (s *WALStore) CountActiveTemplates(ctx context.Context, tenantID string) (int64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return 0, errors.New("tenant id is required")
	}
	var count int64
	err := s.db.WithContext(ctx).
		Model(&EvalTemplateModel{}).
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Count(&count).Error
	if err != nil {
		return 0, fmt.Errorf("count active templates: %w", err)
	}
	return count, nil
}

func (s *WALStore) CreateTemplateVersion(ctx context.Context, version evalpkg.TemplateVersion) error {
	if strings.TrimSpace(version.TenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(version.TemplateID) == "" {
		return errors.New("template id is required")
	}
	if strings.TrimSpace(version.Version) == "" {
		return errors.New("version is required")
	}

	configJSON, err := marshalJSONField(version.Config)
	if err != nil {
		return fmt.Errorf("marshal template version config: %w", err)
	}
	outputKeysJSON, err := marshalJSONField(version.OutputKeys)
	if err != nil {
		return fmt.Errorf("marshal template version output keys: %w", err)
	}

	now := time.Now().UTC()
	model := EvalTemplateVersionModel{
		TenantID:       strings.TrimSpace(version.TenantID),
		TemplateID:     strings.TrimSpace(version.TemplateID),
		Version:        strings.TrimSpace(version.Version),
		ConfigJSON:     configJSON,
		OutputKeysJSON: outputKeysJSON,
		CreatedAt:      now,
	}
	if cl := strings.TrimSpace(version.Changelog); cl != "" {
		model.Changelog = &cl
	}

	return s.db.WithContext(ctx).Create(&model).Error
}

func (s *WALStore) GetTemplateVersion(ctx context.Context, tenantID, templateID, version string) (*evalpkg.TemplateVersion, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(templateID) == "" {
		return nil, errors.New("template id is required")
	}
	if strings.TrimSpace(version) == "" {
		return nil, errors.New("version is required")
	}

	var row EvalTemplateVersionModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND template_id = ? AND version = ?", tenantID, templateID, version).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get template version: %w", err)
	}

	out, err := modelToTemplateVersion(row)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *WALStore) GetLatestTemplateVersion(ctx context.Context, tenantID, templateID string) (*evalpkg.TemplateVersion, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(templateID) == "" {
		return nil, errors.New("template id is required")
	}

	// Look up the template to find the latest version string.
	var tmpl EvalTemplateModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND template_id = ? AND deleted_at IS NULL", tenantID, templateID).
		First(&tmpl).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get template for latest version: %w", err)
	}

	var row EvalTemplateVersionModel
	err = s.db.WithContext(ctx).
		Where("tenant_id = ? AND template_id = ? AND version = ?", tenantID, templateID, tmpl.LatestVersion).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get latest template version: %w", err)
	}

	out, err := modelToTemplateVersion(row)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *WALStore) ListTemplateVersions(ctx context.Context, tenantID, templateID string) ([]evalpkg.TemplateVersion, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(templateID) == "" {
		return nil, errors.New("template id is required")
	}

	var rows []EvalTemplateVersionModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND template_id = ?", tenantID, templateID).
		Order("created_at DESC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list template versions: %w", err)
	}

	out := make([]evalpkg.TemplateVersion, 0, len(rows))
	for _, row := range rows {
		v, err := modelToTemplateVersion(row)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// PublishTemplateVersion atomically creates a new template version and updates
// the parent template's latest_version pointer within a single transaction.
func (s *WALStore) PublishTemplateVersion(ctx context.Context, version evalpkg.TemplateVersion) error {
	if strings.TrimSpace(version.TenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(version.TemplateID) == "" {
		return errors.New("template id is required")
	}
	if strings.TrimSpace(version.Version) == "" {
		return errors.New("version is required")
	}

	configJSON, err := marshalJSONField(version.Config)
	if err != nil {
		return fmt.Errorf("marshal template version config: %w", err)
	}
	outputKeysJSON, err := marshalJSONField(version.OutputKeys)
	if err != nil {
		return fmt.Errorf("marshal template version output keys: %w", err)
	}

	now := time.Now().UTC()
	model := EvalTemplateVersionModel{
		TenantID:       strings.TrimSpace(version.TenantID),
		TemplateID:     strings.TrimSpace(version.TemplateID),
		Version:        strings.TrimSpace(version.Version),
		ConfigJSON:     configJSON,
		OutputKeysJSON: outputKeysJSON,
		CreatedAt:      now,
	}
	if cl := strings.TrimSpace(version.Changelog); cl != "" {
		model.Changelog = &cl
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&model).Error; err != nil {
			return fmt.Errorf("create template version: %w", err)
		}
		result := tx.Model(&EvalTemplateModel{}).
			Where("tenant_id = ? AND template_id = ? AND deleted_at IS NULL",
				version.TenantID, version.TemplateID).
			Updates(map[string]any{
				"latest_version": strings.TrimSpace(version.Version),
				"updated_at":     now,
			})
		if result.Error != nil {
			return fmt.Errorf("update template latest version: %w", result.Error)
		}
		if result.RowsAffected == 0 {
			return evalpkg.ErrNotFound
		}
		return nil
	})
}

func (s *WALStore) UpdateTemplateLatestVersion(ctx context.Context, tenantID, templateID, version string) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(templateID) == "" {
		return errors.New("template id is required")
	}
	if strings.TrimSpace(version) == "" {
		return errors.New("version is required")
	}

	now := time.Now().UTC()
	result := s.db.WithContext(ctx).
		Model(&EvalTemplateModel{}).
		Where("tenant_id = ? AND template_id = ? AND deleted_at IS NULL", tenantID, templateID).
		Updates(map[string]any{
			"latest_version": strings.TrimSpace(version),
			"updated_at":     now,
		})
	if result.Error != nil {
		return fmt.Errorf("update template latest version: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return evalpkg.ErrNotFound
	}
	return nil
}

func (s *WALStore) UpdateTemplateDescription(ctx context.Context, tenantID, templateID, description string) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(templateID) == "" {
		return errors.New("template id is required")
	}

	now := time.Now().UTC()
	result := s.db.WithContext(ctx).
		Model(&EvalTemplateModel{}).
		Where("tenant_id = ? AND template_id = ? AND deleted_at IS NULL", tenantID, templateID).
		Updates(map[string]any{
			"description": description,
			"updated_at":  now,
		})
	if result.Error != nil {
		return fmt.Errorf("update template description: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return evalpkg.ErrNotFound
	}
	return nil
}

func modelToTemplate(row EvalTemplateModel) evalpkg.TemplateDefinition {
	def := evalpkg.TemplateDefinition{
		TenantID:      row.TenantID,
		TemplateID:    row.TemplateID,
		Scope:         evalpkg.TemplateScope(row.Scope),
		LatestVersion: row.LatestVersion,
		Kind:          evalpkg.EvaluatorKind(row.Kind),
		DeletedAt:     row.DeletedAt,
		CreatedAt:     row.CreatedAt.UTC(),
		UpdatedAt:     row.UpdatedAt.UTC(),
	}
	if row.Description != nil {
		def.Description = *row.Description
	}
	return def
}

func modelToTemplateVersion(row EvalTemplateVersionModel) (evalpkg.TemplateVersion, error) {
	config := map[string]any{}
	if err := unmarshalJSONField(row.ConfigJSON, &config); err != nil {
		return evalpkg.TemplateVersion{}, fmt.Errorf("decode template version config: %w", err)
	}
	outputKeys := make([]evalpkg.OutputKey, 0)
	if err := unmarshalJSONField(row.OutputKeysJSON, &outputKeys); err != nil {
		return evalpkg.TemplateVersion{}, fmt.Errorf("decode template version output keys: %w", err)
	}

	v := evalpkg.TemplateVersion{
		TenantID:   row.TenantID,
		TemplateID: row.TemplateID,
		Version:    row.Version,
		Config:     config,
		OutputKeys: outputKeys,
		CreatedAt:  row.CreatedAt.UTC(),
	}
	if row.Changelog != nil {
		v.Changelog = *row.Changelog
	}
	return v, nil
}
