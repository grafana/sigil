package tenantsettings

import (
	"context"
	"errors"
	"strings"
)

type DatasourceSettings struct {
	PrometheusDatasourceUID string `json:"prometheusDatasourceUID"`
	TempoDatasourceUID      string `json:"tempoDatasourceUID"`
}

type Store interface {
	GetTenantDatasourceSettings(ctx context.Context, tenantID string) (DatasourceSettings, error)
	UpsertTenantDatasourceSettings(ctx context.Context, tenantID string, settings DatasourceSettings) error
}

type Service struct {
	store Store
}

func NewService(store Store) *Service {
	if store == nil {
		return nil
	}
	return &Service{store: store}
}

func (s *Service) GetTenantDatasourceSettings(ctx context.Context, tenantID string) (DatasourceSettings, error) {
	if s == nil || s.store == nil {
		return DatasourceSettings{}, errors.New("tenant settings store is not configured")
	}
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return DatasourceSettings{}, errors.New("tenant id is required")
	}
	return s.store.GetTenantDatasourceSettings(ctx, trimmedTenantID)
}

func (s *Service) UpsertTenantDatasourceSettings(ctx context.Context, tenantID string, settings DatasourceSettings) (DatasourceSettings, error) {
	if s == nil || s.store == nil {
		return DatasourceSettings{}, errors.New("tenant settings store is not configured")
	}
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return DatasourceSettings{}, errors.New("tenant id is required")
	}
	settings.PrometheusDatasourceUID = strings.TrimSpace(settings.PrometheusDatasourceUID)
	settings.TempoDatasourceUID = strings.TrimSpace(settings.TempoDatasourceUID)
	if err := s.store.UpsertTenantDatasourceSettings(ctx, trimmedTenantID, settings); err != nil {
		return DatasourceSettings{}, err
	}
	return settings, nil
}
