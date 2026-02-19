package sigil

import (
	"context"
	"errors"
	"fmt"

	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/modelcards"
)

func buildModelCardService(ctx context.Context, cfg config.Config, enableLiveSource bool) (*modelcards.Service, error) {
	snapshot, err := modelcards.LoadEmbeddedSnapshot()
	if err != nil {
		return nil, fmt.Errorf("load embedded model-card snapshot: %w", err)
	}
	supplemental, err := modelcards.LoadEmbeddedSupplemental()
	if err != nil {
		return nil, fmt.Errorf("load embedded supplemental model-card catalog: %w", err)
	}
	if err := modelcards.ValidateSupplementalAgainstSnapshot(*snapshot, supplemental); err != nil {
		return nil, fmt.Errorf("validate supplemental model-card catalog against snapshot: %w", err)
	}

	store := modelcards.NewMemoryStore()
	if err := store.AutoMigrate(ctx); err != nil {
		return nil, fmt.Errorf("auto-migrate model cards memory store: %w", err)
	}

	var source modelcards.Source
	if enableLiveSource {
		source = modelcards.NewOpenRouterSource(cfg.ModelCardsConfig.SourceTimeout)
	} else {
		source = modelcards.NewStaticErrorSource(errors.New("live model-cards source disabled"))
	}

	svc := modelcards.NewServiceWithSupplemental(store, source, snapshot, supplemental, modelcards.Config{
		SyncInterval:  cfg.ModelCardsConfig.SyncInterval,
		LeaseTTL:      cfg.ModelCardsConfig.LeaseTTL,
		SourceTimeout: cfg.ModelCardsConfig.SourceTimeout,
		StaleSoft:     cfg.ModelCardsConfig.StaleSoft,
		StaleHard:     cfg.ModelCardsConfig.StaleHard,
		BootstrapMode: cfg.ModelCardsConfig.BootstrapMode,
	}, nil)

	return svc, nil
}
