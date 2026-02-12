package sigil

import (
	"context"

	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/storage"
)

type querierModule struct {
	blockReader storage.BlockReader
}

type compactorModule struct {
	blockWriter storage.BlockWriter
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

func newCompactorModule(blockWriter storage.BlockWriter) services.Service {
	module := &compactorModule{
		blockWriter: blockWriter,
	}
	return services.NewIdleService(module.start, nil).WithName(config.TargetCompactor)
}

func (m *compactorModule) start(_ context.Context) error {
	_ = m.blockWriter
	return nil
}
