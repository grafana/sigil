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
	"github.com/grafana/sigil/sigil/internal/agentrating"
	"github.com/grafana/sigil/sigil/internal/config"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	evalcontrol "github.com/grafana/sigil/sigil/internal/eval/control"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
	evalingest "github.com/grafana/sigil/sigil/internal/eval/ingest"
	"github.com/grafana/sigil/sigil/internal/feedback"
	"github.com/grafana/sigil/sigil/internal/followup"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/promptinsights"
	"github.com/grafana/sigil/sigil/internal/query"
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

	coldReadConfig := storage.ColdReadConfig{
		TotalBudget:      cfg.QueryRead.ColdTotalBudget,
		IndexReadTimeout: cfg.QueryRead.ColdIndexReadTimeout,
		IndexRetries:     cfg.QueryRead.ColdIndexRetries,
		IndexWorkers:     cfg.QueryRead.ColdIndexWorkers,
		IndexMaxInflight: cfg.QueryRead.ColdIndexMaxInflight,
	}
	indexCacheConfig := storage.IndexCacheConfig{
		Enabled:  true,
		TTL:      cfg.QueryRead.ColdIndexCacheTTL,
		MaxBytes: cfg.QueryRead.ColdIndexCacheMaxBytes,
	}

	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		ConversationStore:  conversationStore,
		WALReader:          walReader,
		BlockMetadataStore: blockMetadataStore,
		BlockReader:        blockReader,
		FeedbackStore:      feedbackStore,
		TempoBaseURL:       cfg.QueryProxy.TempoBaseURL,
		HTTPClient:         &http.Client{Timeout: cfg.QueryProxy.Timeout},
		ColdReadConfig:     coldReadConfig,
		IndexCacheConfig:   indexCacheConfig,
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

	var tenantSettingsSvc *tenantsettings.Service
	if tenantSettingsStore, ok := generationStore.(tenantsettings.Store); ok {
		tenantSettingsSvc = tenantsettings.NewService(tenantSettingsStore)
	}

	discovery := judges.DiscoverFromEnv()
	agentRatingProviderID, agentRatingModelName := cfg.AgentRatingJudgeTarget()
	var agentRater *agentrating.Rater
	var agentRatingStore agentrating.LatestStore
	if store, ok := generationStore.(agentrating.LatestStore); ok {
		agentRatingStore = store
	}
	var promptInsightsAnalyzer *promptinsights.Analyzer
	var promptInsightsStore promptinsights.Store
	if store, ok := generationStore.(promptinsights.Store); ok {
		promptInsightsStore = store
	}

	followupSvc := followup.NewService(discovery, cfg.EvalDefaultJudgeModel)

	if _, ok := discovery.Client(agentRatingProviderID); ok {
		agentRater = agentrating.NewRaterWithTarget(discovery, agentRatingProviderID, agentRatingModelName)
		promptInsightsAnalyzer = promptinsights.NewAnalyzer(discovery, agentRatingProviderID+"/"+agentRatingModelName)
	} else {
		_ = level.Warn(logger).Log(
			"msg", "agent rating disabled because configured judge provider is unavailable",
			"provider", agentRatingProviderID,
			"model", agentRatingModelName,
		)
	}

	var controlSvc *evalcontrol.Service
	var templateSvc *evalcontrol.TemplateService
	var ingestScoreSvc *evalingest.Service
	var testSvc *evalcontrol.TestService
	if evalStore, ok := generationStore.(evalpkg.EvalStore); ok && evalStore != nil {
		testReadConfig := evalTestColdReadConfig(cfg)
		testReader := storage.NewFanOutStore(
			walReader,
			blockMetadataStore,
			blockReader,
			storage.WithColdReadConfig(testReadConfig),
			storage.WithIndexCacheConfig(indexCacheConfig),
		)
		evalRegistry := map[evalpkg.EvaluatorKind]evaluators.Evaluator{
			evalpkg.EvaluatorKindRegex:      evaluators.NewRegexEvaluator(),
			evalpkg.EvaluatorKindJSONSchema: evaluators.NewJSONSchemaEvaluator(),
			evalpkg.EvaluatorKindHeuristic:  evaluators.NewHeuristicEvaluator(),
			evalpkg.EvaluatorKindLLMJudge:   evaluators.NewLLMJudgeEvaluator(discovery, cfg.EvalDefaultJudgeModel),
		}
		testSvc = evalcontrol.NewTestService(testReader, evalRegistry)

		// Wire optional stores supported by the active backend.
		var controlOpts []evalcontrol.ServiceOption
		var templateStore evalpkg.TemplateStore
		if ts, ok := generationStore.(evalpkg.TemplateStore); ok {
			templateStore = ts
		}

		if lister, ok := generationStore.(storage.RecentGenerationLister); ok {
			controlOpts = append(controlOpts, evalcontrol.WithPreview(lister, cfg.EvalPreviewWindowHours))
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

	var savedConvSvc *evalcontrol.SavedConversationService
	if scStore, ok := generationStore.(evalpkg.SavedConversationStore); ok {
		var scOpts []evalcontrol.SavedConversationServiceOption
		if mw, ok := generationStore.(evalcontrol.ManualConversationWriter); ok {
			scOpts = append(scOpts, evalcontrol.WithManualWriter(mw))
		}
		if md, ok := generationStore.(evalcontrol.ManualConversationDeleter); ok {
			scOpts = append(scOpts, evalcontrol.WithManualDeleter(md))
		}
		if cleaner, ok := generationStore.(evalcontrol.CollectionMemberCleaner); ok {
			scOpts = append(scOpts, evalcontrol.WithCollectionMemberCleaner(cleaner))
		}
		savedConvSvc = evalcontrol.NewSavedConversationService(scStore, conversationStore, scOpts...)
	}

	var collectionSvc *evalcontrol.CollectionService
	if colStore, ok := generationStore.(evalpkg.CollectionStore); ok {
		if scStore, ok := generationStore.(evalpkg.SavedConversationStore); ok {
			collectionSvc = evalcontrol.NewCollectionService(colStore, scStore)
		}
	}

	if collectionSvc != nil && savedConvSvc != nil {
		savedConvSvc.SetCollectionLister(collectionSvc)
	}

	if registry != nil {
		registry.RegisterHTTP(func(mux *http.ServeMux, protectedMiddleware func(http.Handler) http.Handler) {
			server.RegisterQueryRoutes(
				mux,
				querySvc,
				agentRater,
				agentRatingStore,
				feedbackSvc,
				cfg.ConversationRatingsEnabled,
				cfg.ConversationAnnotationsEnabled,
				modelCardSvc,
				logger,
				protectedMiddleware,
				followupSvc,
				server.PromptInsightsOption{
					Analyzer: promptInsightsAnalyzer,
					Store:    promptInsightsStore,
				},
			)
			server.RegisterSettingsRoutes(mux, tenantSettingsSvc, protectedMiddleware)
			evalcontrol.RegisterHTTPRoutes(mux, controlSvc, templateSvc, testSvc, protectedMiddleware)
			evalcontrol.RegisterSavedConversationRoutes(mux, savedConvSvc, protectedMiddleware)
			evalcontrol.RegisterCollectionRoutes(mux, collectionSvc, protectedMiddleware)
			evalingest.RegisterHTTPRoutes(mux, ingestScoreSvc, protectedMiddleware)
		})
	}

	module := &querierModule{
		modelCardSvc: modelCardSvc,
		runErr:       make(chan error, 1),
	}
	return services.NewBasicService(module.start, module.run, module.stop).WithName(config.TargetQuerier), nil
}

func evalTestColdReadConfig(cfg config.Config) storage.ColdReadConfig {
	return storage.ColdReadConfig{
		// eval:test already has a 30s handler timeout. Reusing the aggressive
		// conversation-query cold-read budget causes generation fetches to fail
		// around 6s before the request deadline.
		TotalBudget:      cfg.QueryProxy.Timeout,
		IndexReadTimeout: cfg.QueryRead.ColdIndexReadTimeout,
		IndexRetries:     cfg.QueryRead.ColdIndexRetries,
		IndexWorkers:     cfg.QueryRead.ColdIndexWorkers,
		IndexMaxInflight: cfg.QueryRead.ColdIndexMaxInflight,
	}
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
