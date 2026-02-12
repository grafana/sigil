package sigil

import (
	"context"
	"fmt"
	"sort"

	"github.com/go-kit/log"
	"github.com/grafana/dskit/modules"
	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/storage/object"
)

type Runtime struct {
	cfg        config.Config
	logger     log.Logger
	moduleInit *modules.Manager
}

func NewRuntime(cfg config.Config, logger log.Logger) (*Runtime, error) {
	if logger == nil {
		logger = log.NewNopLogger()
	}

	runtime := &Runtime{
		cfg:        cfg,
		logger:     logger,
		moduleInit: modules.NewManager(logger),
	}

	if err := runtime.registerModules(); err != nil {
		return nil, err
	}

	return runtime, nil
}

func (r *Runtime) Run(ctx context.Context) error {
	moduleServices, err := r.moduleInit.InitModuleServices(r.cfg.Target)
	if err != nil {
		return err
	}
	if len(moduleServices) == 0 {
		return fmt.Errorf("no services initialized for target %q", r.cfg.Target)
	}

	servicesList := make([]services.Service, 0, len(moduleServices))
	moduleNames := make([]string, 0, len(moduleServices))
	for moduleName := range moduleServices {
		moduleNames = append(moduleNames, moduleName)
	}
	sort.Strings(moduleNames)
	for _, moduleName := range moduleNames {
		servicesList = append(servicesList, moduleServices[moduleName])
	}

	manager, err := services.NewManager(servicesList...)
	if err != nil {
		return err
	}

	watcher := services.NewFailureWatcher()
	defer watcher.Close()
	watcher.WatchManager(manager)

	if err := services.StartManagerAndAwaitHealthy(ctx, manager); err != nil {
		return err
	}

	select {
	case <-ctx.Done():
	case err := <-watcher.Chan():
		_ = services.StopManagerAndAwaitStopped(context.Background(), manager)
		return err
	}

	return services.StopManagerAndAwaitStopped(context.Background(), manager)
}

func (r *Runtime) registerModules() error {
	r.moduleInit.RegisterModule(config.TargetServer, r.initServerModule)
	r.moduleInit.RegisterModule(config.TargetQuerier, r.initQuerierModule)
	r.moduleInit.RegisterModule(config.TargetCompactor, r.initCompactorModule)
	r.moduleInit.RegisterModule(config.TargetAll, nil)

	return r.moduleInit.AddDependency(config.TargetAll, config.TargetServer, config.TargetQuerier, config.TargetCompactor)
}

func (r *Runtime) initServerModule() (services.Service, error) {
	return newServerModule(r.cfg, r.logger), nil
}

func (r *Runtime) initQuerierModule() (services.Service, error) {
	blockStore := object.NewStore(r.cfg.ObjectStoreEndpoint, r.cfg.ObjectStoreBucket)
	return newQuerierModule(blockStore), nil
}

func (r *Runtime) initCompactorModule() (services.Service, error) {
	blockStore := object.NewStore(r.cfg.ObjectStoreEndpoint, r.cfg.ObjectStoreBucket)
	return newCompactorModule(blockStore), nil
}
