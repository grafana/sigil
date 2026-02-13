package sigil

import (
	"context"
	"errors"

	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/modelcards"
)

type catalogSyncModule struct {
	svc *modelcards.Service
}

func newCatalogSyncModule(_ config.Config, svc *modelcards.Service) (services.Service, error) {
	if svc == nil {
		return nil, errors.New("model-card service is required")
	}
	module := &catalogSyncModule{
		svc: svc,
	}
	return services.NewBasicService(module.start, module.run, module.stop).WithName(config.TargetCatalogSync), nil
}

func (m *catalogSyncModule) start(_ context.Context) error {
	return nil
}

func (m *catalogSyncModule) run(ctx context.Context) error {
	return m.svc.RunSyncLoop(ctx)
}

func (m *catalogSyncModule) stop(_ error) error {
	return nil
}
