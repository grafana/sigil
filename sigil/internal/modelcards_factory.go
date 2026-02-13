package sigil

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
)

func buildModelCardService(ctx context.Context, cfg config.Config, enableLiveSource bool) (*modelcards.Service, error) {
	snapshot, err := modelcards.LoadEmbeddedSnapshot()
	if err != nil {
		return nil, fmt.Errorf("load embedded model-card snapshot: %w", err)
	}

	var store modelcards.Store
	switch strings.ToLower(strings.TrimSpace(cfg.StorageBackend)) {
	case "", "mysql":
		mysqlStore, err := mysql.NewModelCardStore(cfg.MySQLDSN)
		if err != nil {
			return nil, fmt.Errorf("create model cards mysql store: %w", err)
		}
		if err := mysqlStore.AutoMigrate(ctx); err != nil {
			return nil, err
		}
		store = mysqlStore
	case "memory":
		store = modelcards.NewMemoryStore()
	default:
		return nil, fmt.Errorf("unsupported storage backend %q for model cards", cfg.StorageBackend)
	}

	var source modelcards.Source
	if enableLiveSource && (cfg.StorageBackend == "" || strings.EqualFold(cfg.StorageBackend, "mysql")) {
		source = modelcards.NewOpenRouterSource(cfg.ModelCardsConfig.SourceTimeout)
	} else {
		source = modelcards.NewStaticErrorSource(errors.New("live model-cards source disabled"))
	}

	svc := modelcards.NewService(store, source, snapshot, modelcards.Config{
		SyncInterval:  cfg.ModelCardsConfig.SyncInterval,
		LeaseTTL:      cfg.ModelCardsConfig.LeaseTTL,
		SourceTimeout: cfg.ModelCardsConfig.SourceTimeout,
		StaleSoft:     cfg.ModelCardsConfig.StaleSoft,
		StaleHard:     cfg.ModelCardsConfig.StaleHard,
		BootstrapMode: cfg.ModelCardsConfig.BootstrapMode,
	}, nil)

	return svc, nil
}
