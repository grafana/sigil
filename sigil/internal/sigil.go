package sigil

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/go-kit/log"
	"github.com/grafana/dskit/modules"
	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
	evalworker "github.com/grafana/sigil/sigil/internal/eval/worker"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
	"github.com/grafana/sigil/sigil/internal/storage/object"
)

type Runtime struct {
	cfg        config.Config
	logger     log.Logger
	moduleInit *modules.Manager
	modelCards *modelcards.Service
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
	r.moduleInit.RegisterModule(config.TargetCatalogSync, r.initCatalogSyncModule)
	r.moduleInit.RegisterModule(config.TargetEvalWorker, r.initEvalWorkerModule)
	r.moduleInit.RegisterModule(config.TargetAll, nil)

	return r.moduleInit.AddDependency(config.TargetAll, config.TargetServer, config.TargetQuerier, config.TargetCompactor, config.TargetCatalogSync, config.TargetEvalWorker)
}

func (r *Runtime) initServerModule() (services.Service, error) {
	modelCardSvc, err := r.getModelCardService(context.Background(), true)
	if err != nil {
		return nil, err
	}
	runModelCardSync := r.cfg.Target == config.TargetServer
	return newServerModule(r.cfg, r.logger, modelCardSvc, runModelCardSync), nil
}

func (r *Runtime) initQuerierModule() (services.Service, error) {
	blockStore := newBlockStorePlaceholder(r.cfg.ObjectStore)
	return newQuerierModule(blockStore), nil
}

func (r *Runtime) initCompactorModule() (services.Service, error) {
	switch strings.ToLower(strings.TrimSpace(r.cfg.StorageBackend)) {
	case "", "mysql":
	default:
		return nil, fmt.Errorf("compactor requires mysql storage backend, got %q", r.cfg.StorageBackend)
	}

	walStore, err := mysql.NewWALStore(r.cfg.MySQLDSN)
	if err != nil {
		return nil, fmt.Errorf("create mysql wal store for compactor: %w", err)
	}
	bootstrapCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := walStore.AutoMigrate(bootstrapCtx); err != nil {
		return nil, err
	}

	blockStore, err := newObjectBlockStore(bootstrapCtx, r.cfg.ObjectStore)
	if err != nil {
		return nil, fmt.Errorf("create object store for compactor: %w", err)
	}

	return newCompactorModule(
		r.cfg.CompactorConfig,
		r.logger,
		"",
		walStore,
		walStore,
		walStore,
		walStore,
		blockStore,
		walStore,
	), nil
}

func newBlockStorePlaceholder(cfg config.ObjectStoreConfig) *object.Store {
	backend := strings.ToLower(strings.TrimSpace(cfg.Backend))
	switch backend {
	case "gcs":
		bucket := strings.TrimSpace(cfg.GCS.Bucket)
		if bucket == "" {
			bucket = strings.TrimSpace(cfg.Bucket)
		}
		return object.NewStore("gcs://"+bucket, bucket)
	case "azure":
		container := strings.TrimSpace(cfg.Azure.ContainerName)
		if container == "" {
			container = strings.TrimSpace(cfg.Bucket)
		}
		return object.NewStore("azure://"+container, container)
	default:
		return object.NewStore(cfg.S3.Endpoint, cfg.Bucket)
	}
}

func (r *Runtime) initCatalogSyncModule() (services.Service, error) {
	modelCardSvc, err := r.getModelCardService(context.Background(), true)
	if err != nil {
		return nil, err
	}
	return newCatalogSyncModule(r.cfg, modelCardSvc)
}

func (r *Runtime) initEvalWorkerModule() (services.Service, error) {
	if !r.cfg.EvalWorkerEnabled {
		return services.NewIdleService(func(context.Context) error { return nil }, nil).WithName(config.TargetEvalWorker), nil
	}

	switch strings.ToLower(strings.TrimSpace(r.cfg.StorageBackend)) {
	case "", "mysql":
	default:
		return nil, fmt.Errorf("eval worker requires mysql storage backend, got %q", r.cfg.StorageBackend)
	}

	store, err := mysql.NewWALStore(r.cfg.MySQLDSN)
	if err != nil {
		return nil, fmt.Errorf("create mysql eval worker store: %w", err)
	}
	bootstrapCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := store.AutoMigrate(bootstrapCtx); err != nil {
		return nil, err
	}

	blockReader, err := newObjectBlockReader(bootstrapCtx, r.cfg.ObjectStore)
	if err != nil {
		return nil, err
	}
	reader := evalworker.NewHotColdGenerationReader(store, store, blockReader)

	return evalworker.NewService(evalworker.Config{
		Enabled:           r.cfg.EvalWorkerEnabled,
		MaxConcurrent:     r.cfg.EvalMaxConcurrent,
		MaxRatePerMinute:  r.cfg.EvalMaxRate,
		MaxAttempts:       r.cfg.EvalMaxAttempts,
		ClaimBatchSize:    r.cfg.EvalClaimBatchSize,
		PollInterval:      r.cfg.EvalPollInterval,
		DefaultJudgeModel: r.cfg.EvalDefaultJudgeModel,
	}, r.logger, store, reader, judges.DiscoverFromEnv()), nil
}

func (r *Runtime) getModelCardService(ctx context.Context, enableLiveSource bool) (*modelcards.Service, error) {
	if r.modelCards != nil {
		return r.modelCards, nil
	}
	svc, err := buildModelCardService(ctx, r.cfg, enableLiveSource)
	if err != nil {
		return nil, err
	}
	r.modelCards = svc
	return svc, nil
}
