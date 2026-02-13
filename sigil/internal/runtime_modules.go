package sigil

import (
	"context"

	"github.com/go-kit/log"
	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/storage"
	compactorstorage "github.com/grafana/sigil/sigil/internal/storage/compactor"
)

type querierModule struct {
	blockReader storage.BlockReader
}

func newQuerierModule(blockReader storage.BlockReader) services.Service {
	module := &querierModule{
		blockReader: blockReader,
	}
	return services.NewIdleService(module.start, nil).WithName(config.TargetQuerier)
}

func (m *querierModule) start(_ context.Context) error {
	_ = m.blockReader
	return nil
}

func newCompactorModule(
	cfg config.CompactorConfig,
	logger log.Logger,
	ownerID string,
	discoverer compactorstorage.TenantDiscoverer,
	leaser compactorstorage.TenantLeaser,
	claimer compactorstorage.Claimer,
	truncator compactorstorage.Truncator,
	blockWriter storage.BlockWriter,
	metadataStore storage.BlockMetadataStore,
) services.Service {
	return compactorstorage.NewService(cfg, logger, ownerID, discoverer, leaser, claimer, truncator, blockWriter, metadataStore)
}
