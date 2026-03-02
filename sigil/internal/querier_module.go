package sigil

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	evalcontrol "github.com/grafana/sigil/sigil/internal/eval/control"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
	evalingest "github.com/grafana/sigil/sigil/internal/eval/ingest"
	"github.com/grafana/sigil/sigil/internal/feedback"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/internal/queryproxy"
	"github.com/grafana/sigil/sigil/internal/server"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/tenantsettings"
)

// querierModule owns read/query HTTP wiring and runs the model-cards sync loop.
type querierModule struct {
	modelCardSvc *modelcards.Service
	runErr       chan error
}

func newQuerierModule(
	ctx context.Context,
	cfg config.Config,
	logger log.Logger,
	modelCardSvc *modelcards.Service,
	registry *serverTransportRegistry,
) (services.Service, error) {
	if modelCardSvc == nil {
		return nil, errors.New("model-card service is required")
	}

	generationStore, err := buildGenerationStore(ctx, cfg, false)
	if err != nil {
		return nil, err
	}

	var feedbackStore feedback.Store
	var feedbackSvc *feedback.Service
	if cfg.ConversationRatingsEnabled || cfg.ConversationAnnotationsEnabled {
		feedbackStore, err = buildFeedbackStore(cfg.StorageBackend, generationStore)
		if err != nil {
			return nil, err
		}
		feedbackSvc = feedback.NewService(feedbackStore)
	}

	var conversationStore storage.ConversationStore
	if store, ok := generationStore.(storage.ConversationStore); ok {
		conversationStore = store
	}
	var walReader storage.WALReader
	if reader, ok := generationStore.(storage.WALReader); ok {
		walReader = reader
	}
	var blockMetadataStore storage.BlockMetadataStore
	if metadataStore, ok := generationStore.(storage.BlockMetadataStore); ok {
		blockMetadataStore = metadataStore
	}

	readerCtx, cancelReader := context.WithTimeout(ctx, 5*time.Second)
	defer cancelReader()
	blockReader, err := buildBlockReader(readerCtx, cfg.ObjectStore)
	if err != nil {
		_ = level.Warn(logger).Log("msg", "querier cold-store reader unavailable; continuing with hot-store only", "err", err)
		blockReader = nil
	}

	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		ConversationStore:  conversationStore,
		WALReader:          walReader,
		BlockMetadataStore: blockMetadataStore,
		BlockReader:        blockReader,
		FeedbackStore:      feedbackStore,
		TempoBaseURL:       cfg.QueryProxy.TempoBaseURL,
		HTTPClient:         &http.Client{Timeout: cfg.QueryProxy.Timeout},
	})
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.GrafanaURL) != "" {
		tempoClient, err := query.NewGrafanaTempoHTTPClient(
			cfg.GrafanaURL,
			cfg.GrafanaTempoDatasourceUID,
			cfg.GrafanaServiceAccountToken,
			&http.Client{Timeout: cfg.QueryProxy.Timeout},
		)
		if err != nil {
			return nil, err
		}
		querySvc.SetTempoClient(tempoClient)
	}

	queryProxy, err := queryproxy.New(queryproxy.Config{
		PrometheusBaseURL: cfg.QueryProxy.PrometheusBaseURL,
		TempoBaseURL:      cfg.QueryProxy.TempoBaseURL,
		Timeout:           cfg.QueryProxy.Timeout,
	})
	if err != nil {
		return nil, err
	}

	var tenantSettingsSvc *tenantsettings.Service
	if tenantSettingsStore, ok := generationStore.(tenantsettings.Store); ok {
		tenantSettingsSvc = tenantsettings.NewService(tenantSettingsStore)
	}

	var controlSvc *evalcontrol.Service
	var templateSvc *evalcontrol.TemplateService
	var ingestScoreSvc *evalingest.Service
	if evalStore, ok := generationStore.(evalpkg.EvalStore); ok && evalStore != nil {
		discovery := judges.DiscoverFromEnv()

		// Wire template store if the underlying storage supports it.
		var controlOpts []evalcontrol.ServiceOption
		var templateStore evalpkg.TemplateStore
		if ts, ok := generationStore.(evalpkg.TemplateStore); ok {
			templateStore = ts
			if err := evalcontrol.BootstrapPredefinedTemplates(ctx, templateStore); err != nil {
				_ = level.Warn(logger).Log("msg", "failed to bootstrap predefined templates", "err", err)
			} else {
				_ = level.Info(logger).Log("msg", "predefined templates bootstrapped")
			}
			controlOpts = append(controlOpts, evalcontrol.WithTemplateStore(templateStore))
		}

		controlSvc = evalcontrol.NewService(evalStore, judgeDiscoveryAdapter{discovery: discovery}, controlOpts...)

		if templateStore != nil {
			templateSvc = evalcontrol.NewTemplateService(templateStore, controlSvc)
		}
		scoreLookup := buildScoreGenerationLookup(walReader, blockMetadataStore, blockReader)
		ingestScoreSvc = evalingest.NewService(evalStore, scoreLookup, false)

		seedTenantID := strings.TrimSpace(cfg.FakeTenantID)
		if seedTenantID != "" && strings.TrimSpace(cfg.EvalSeedFile) != "" {
			loadSeed, err := shouldLoadEvalSeed(ctx, evalStore, seedTenantID)
			if err != nil {
				return nil, err
			}
			if loadSeed {
				report, err := evalcontrol.LoadYAMLSeedFileWithOptions(
					ctx,
					evalStore,
					seedTenantID,
					cfg.EvalSeedFile,
					evalcontrol.SeedLoadOptions{Strict: cfg.EvalSeedStrict},
				)
				if err != nil {
					return nil, err
				}
				for _, issue := range report.Issues {
					_ = level.Warn(logger).Log(
						"msg", "eval seed skipped invalid entry",
						"tenant_id", seedTenantID,
						"entity", issue.Entity,
						"id", issue.ID,
						"err", issue.Error,
					)
				}
				_ = level.Info(logger).Log(
					"msg", "eval seed load completed",
					"tenant_id", seedTenantID,
					"strict", cfg.EvalSeedStrict,
					"created_evaluators", report.CreatedEvaluators,
					"created_rules", report.CreatedRules,
					"skipped_evaluators", report.SkippedEvaluators,
					"skipped_rules", report.SkippedRules,
				)
			} else {
				_ = level.Info(logger).Log("msg", "skip eval seed load because tenant already has evaluation config", "tenant_id", seedTenantID)
			}
		}
	}

	if registry != nil {
		registry.RegisterHTTP(func(mux *http.ServeMux, protectedMiddleware func(http.Handler) http.Handler) {
			server.RegisterQueryRoutesWithQueryProxy(
				mux,
				querySvc,
				feedbackSvc,
				cfg.ConversationRatingsEnabled,
				cfg.ConversationAnnotationsEnabled,
				modelCardSvc,
				protectedMiddleware,
				queryProxy,
			)
			server.RegisterSettingsRoutes(mux, tenantSettingsSvc, protectedMiddleware)
			evalcontrol.RegisterHTTPRoutes(mux, controlSvc, templateSvc, protectedMiddleware)
			evalingest.RegisterHTTPRoutes(mux, ingestScoreSvc, protectedMiddleware)
		})
	}

	module := &querierModule{
		modelCardSvc: modelCardSvc,
		runErr:       make(chan error, 1),
	}
	return services.NewBasicService(module.start, module.run, module.stop).WithName(config.TargetQuerier), nil
}

func (m *querierModule) start(_ context.Context) error {
	return nil
}

func (m *querierModule) run(ctx context.Context) error {
	if m.modelCardSvc != nil {
		go func() {
			if err := m.modelCardSvc.RunSyncLoop(ctx); err != nil {
				m.pushRunError(err)
			}
		}()
	}

	select {
	case <-ctx.Done():
		return nil
	case err := <-m.runErr:
		return err
	}
}

func (m *querierModule) stop(_ error) error {
	return nil
}

func (m *querierModule) pushRunError(err error) {
	select {
	case m.runErr <- err:
	default:
	}
}
