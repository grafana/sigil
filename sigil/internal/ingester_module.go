package sigil

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-kit/log"
	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	evalenqueue "github.com/grafana/sigil/sigil/internal/eval/enqueue"
	evalrules "github.com/grafana/sigil/sigil/internal/eval/rules"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/server"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
	"google.golang.org/grpc"
)

// ingesterModule owns generation ingest HTTP/gRPC wiring and the durable eval
// enqueue dispatcher that reacts to newly ingested generations.
type ingesterModule struct {
	evalEnqueueDispatcher *evalenqueue.Service
	runErr                chan error
}

type walWriteReadiness interface {
	WALWriteReady(context.Context) error
}

func newIngesterModule(ctx context.Context, cfg config.Config, logger log.Logger, registry *serverTransportRegistry) (services.Service, error) {
	generationStore, err := buildGenerationStore(ctx, cfg, true)
	if err != nil {
		return nil, err
	}

	generationSvc := generationingest.NewService(generationStore)
	generationGRPC := generationingest.NewGRPCServer(generationSvc)

	if registry != nil {
		registry.RegisterHTTP(func(mux *http.ServeMux, protectedMiddleware func(http.Handler) http.Handler) {
			server.RegisterIngestRoutes(mux, generationSvc, protectedMiddleware)
		})
		registry.RegisterGRPC(func(server *grpc.Server) {
			sigilv1.RegisterGenerationIngestServiceServer(server, generationGRPC)
		})
		if readinessStore, ok := generationStore.(walWriteReadiness); ok {
			registry.RegisterReadiness(readinessStore.WALWriteReady)
		}
	}

	dispatcher := configureIngesterEvalEnqueue(cfg, logger, generationStore)

	module := &ingesterModule{
		evalEnqueueDispatcher: dispatcher,
		runErr:                make(chan error, 1),
	}
	return services.NewBasicService(module.start, module.run, module.stop).WithName(config.TargetIngester), nil
}

func configureIngesterEvalEnqueue(cfg config.Config, logger log.Logger, generationStore generationingest.Store) *evalenqueue.Service {
	mysqlStore, ok := generationStore.(*mysql.WALStore)
	if !ok {
		return nil
	}

	mysqlStore.SetEvalEnqueueEnabled(cfg.EvalWorkerEnabled)
	if !cfg.EvalWorkerEnabled {
		return nil
	}

	evalStore, ok := generationStore.(evalpkg.EvalStore)
	if !ok || evalStore == nil {
		return nil
	}

	engine := evalrules.NewEngine(evalStore)
	dispatcher := evalenqueue.NewService(
		evalenqueue.Config{Enabled: cfg.EvalWorkerEnabled},
		logger,
		evalEnqueueStoreAdapter{store: mysqlStore},
		evalEnqueueProcessorAdapter{engine: engine},
	)
	mysqlStore.SetEvalHook(evalHookAdapter{notifier: dispatcher})
	return dispatcher
}

func (m *ingesterModule) start(_ context.Context) error {
	return nil
}

func (m *ingesterModule) run(ctx context.Context) error {
	if m.evalEnqueueDispatcher != nil {
		go func() {
			if err := m.evalEnqueueDispatcher.Run(ctx); err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				m.pushRunError(err)
			}
		}()
	}

	select {
	case <-ctx.Done():
		return nil
	case err := <-m.runErr:
		if ctx.Err() != nil || errors.Is(err, context.Canceled) {
			return nil
		}
		return err
	}
}

func (m *ingesterModule) stop(_ error) error {
	return nil
}

func (m *ingesterModule) pushRunError(err error) {
	select {
	case m.runErr <- err:
	default:
	}
}
