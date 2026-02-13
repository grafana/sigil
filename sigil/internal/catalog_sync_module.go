package sigil

import (
	"context"
	"fmt"

	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/modelcards"
)

type catalogSyncModule struct {
	cfg config.Config
	svc *modelcards.Service
}

func newCatalogSyncModule(cfg config.Config) (services.Service, error) {
	svc, err := buildModelCardService(context.Background(), cfg, true)
	if err != nil {
		return nil, fmt.Errorf("build model card service for catalog sync: %w", err)
	}
	module := &catalogSyncModule{
		cfg: cfg,
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
