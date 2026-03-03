package mysql

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/grafana/sigil/sigil/internal/tenantsettings"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *WALStore) GetTenantDatasourceSettings(ctx context.Context, tenantID string) (tenantsettings.DatasourceSettings, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return tenantsettings.DatasourceSettings{}, fmt.Errorf("tenant id is required")
	}

	var row TenantSettingsModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ?", trimmedTenantID).
		Take(&row).Error
	if errorsIsRecordNotFound(err) {
		return tenantsettings.DatasourceSettings{}, nil
	}
	if err != nil {
		return tenantsettings.DatasourceSettings{}, fmt.Errorf("load tenant settings: %w", err)
	}
	return tenantsettings.DatasourceSettings{
		PrometheusDatasourceUID: row.PrometheusDatasourceUID,
		TempoDatasourceUID:      row.TempoDatasourceUID,
	}, nil
}

func (s *WALStore) UpsertTenantDatasourceSettings(ctx context.Context, tenantID string, settings tenantsettings.DatasourceSettings) error {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return fmt.Errorf("tenant id is required")
	}

	row := TenantSettingsModel{
		TenantID:                trimmedTenantID,
		PrometheusDatasourceUID: strings.TrimSpace(settings.PrometheusDatasourceUID),
		TempoDatasourceUID:      strings.TrimSpace(settings.TempoDatasourceUID),
	}
	err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "tenant_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"prometheus_datasource_uid", "tempo_datasource_uid", "updated_at"}),
	}).Create(&row).Error
	if err != nil {
		return fmt.Errorf("upsert tenant settings: %w", err)
	}
	return nil
}

func errorsIsRecordNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
