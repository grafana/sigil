package sigil

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	evalcontrol "github.com/grafana/sigil/sigil/internal/eval/control"
	evalenqueue "github.com/grafana/sigil/sigil/internal/eval/enqueue"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
	evalingest "github.com/grafana/sigil/sigil/internal/eval/ingest"
	evalrules "github.com/grafana/sigil/sigil/internal/eval/rules"
	evalworker "github.com/grafana/sigil/sigil/internal/eval/worker"
	"github.com/grafana/sigil/sigil/internal/feedback"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/server"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
)

// serverModule owns transport listeners only. Runtime role modules register
// route/service handlers through serverTransportRegistry.
type serverModule struct {
	cfg    config.Config
	logger log.Logger

	registry *serverTransportRegistry

	apiServer    *http.Server
	grpcServer   *grpc.Server
	grpcListener net.Listener

	runErr chan error
}

func newServerModule(cfg config.Config, logger log.Logger, registry *serverTransportRegistry) services.Service {
	module := &serverModule{
		cfg:      cfg,
		logger:   logger,
		registry: registry,
		runErr:   make(chan error, 2),
	}
	return services.NewBasicService(module.start, module.run, module.stop).WithName(config.TargetServer)
}

func (m *serverModule) start(_ context.Context) error {
	tenantAuthCfg := tenantauth.Config{
		Enabled:      m.cfg.AuthEnabled,
		FakeTenantID: m.cfg.FakeTenantID,
	}
	protectedHTTP := tenantauth.HTTPMiddleware(tenantAuthCfg)

	apiMux := http.NewServeMux()
	server.RegisterCoreRoutes(apiMux)
	if m.registry != nil {
		m.registry.ApplyHTTP(apiMux, protectedHTTP)
	}
	httpHandler := withHTTPTracing(apiMux)
	m.apiServer = &http.Server{
		Addr:    m.cfg.HTTPAddr,
		Handler: httpHandler,
	}

	startGRPC := shouldStartGRPCServer(m.registry)
	if startGRPC {
		m.grpcServer = grpc.NewServer(
			grpc.StatsHandler(otelgrpc.NewServerHandler()),
			grpc.ChainUnaryInterceptor(
				grpcMetricsUnaryInterceptor(),
				tenantauth.UnaryServerInterceptor(tenantAuthCfg),
			),
			grpc.ChainStreamInterceptor(
				grpcMetricsStreamInterceptor(),
				tenantauth.StreamServerInterceptor(tenantAuthCfg),
			),
		)
		if m.registry != nil {
			m.registry.ApplyGRPC(m.grpcServer)
		}

		listener, err := net.Listen("tcp", m.cfg.OTLPGRPCAddr)
		if err != nil {
			return fmt.Errorf("listen grpc %s: %w", m.cfg.OTLPGRPCAddr, err)
		}
		m.grpcListener = listener
	}

	go m.serveHTTP()
	if startGRPC {
		go m.serveGRPC()
	}
	return nil
}

func (m *serverModule) run(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return nil
	case err := <-m.runErr:
		return err
	}
}

func (m *serverModule) stop(_ error) error {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if m.apiServer != nil {
		_ = m.apiServer.Shutdown(shutdownCtx)
	}
	if m.grpcServer != nil {
		m.grpcServer.GracefulStop()
	}
	if m.grpcListener != nil {
		_ = m.grpcListener.Close()
	}

	return nil
}

func (m *serverModule) serveHTTP() {
	_ = level.Info(m.logger).Log("msg", "sigil http listening", "addr", m.cfg.HTTPAddr)
	err := m.apiServer.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		m.pushRunError(err)
	}
}

func (m *serverModule) serveGRPC() {
	_ = level.Info(m.logger).Log("msg", "sigil grpc listening", "addr", m.cfg.OTLPGRPCAddr)
	err := m.grpcServer.Serve(m.grpcListener)
	if err != nil && !errors.Is(err, grpc.ErrServerStopped) {
		m.pushRunError(err)
	}
}

func shouldStartGRPCServer(registry *serverTransportRegistry) bool {
	if registry == nil {
		return false
	}
	return registry.HasGRPCRegistrars()
}

func (m *serverModule) pushRunError(err error) {
	select {
	case m.runErr <- err:
	default:
	}
}

type statusCapturingResponseWriter struct {
	http.ResponseWriter
	statusCode   int
	bytesWritten int
}

type routePatternResolver interface {
	Handler(r *http.Request) (http.Handler, string)
}

func (w *statusCapturingResponseWriter) Unwrap() http.ResponseWriter {
	if w == nil {
		return nil
	}
	return w.ResponseWriter
}

func (w *statusCapturingResponseWriter) WriteHeader(statusCode int) {
	w.statusCode = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *statusCapturingResponseWriter) Write(body []byte) (int, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(body)
	w.bytesWritten += n
	return n, err
}

func (w *statusCapturingResponseWriter) status() int {
	if w.statusCode == 0 {
		return http.StatusOK
	}
	return w.statusCode
}

func resolveRoutePattern(next http.Handler, req *http.Request) string {
	if next == nil || req == nil {
		return ""
	}
	resolver, ok := next.(routePatternResolver)
	if !ok {
		return strings.TrimSpace(req.Pattern)
	}
	_, pattern := resolver.Handler(req)
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return ""
	}

	// ServeMux patterns may be "METHOD path". Keep only the route template.
	if _, route, hasMethod := strings.Cut(pattern, " "); hasMethod {
		return strings.TrimSpace(route)
	}
	return pattern
}

func withHTTPTracing(next http.Handler) http.Handler {
	if next == nil {
		return http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	}
	tracer := otel.Tracer("github.com/grafana/sigil/server/http")

	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req == nil {
			next.ServeHTTP(w, req)
			return
		}
		start := time.Now()
		routePattern := resolveRoutePattern(next, req)
		requestBytes := req.ContentLength
		if requestBytes < 0 {
			requestBytes = 0
		}

		ctx := req.Context()
		propagator := otel.GetTextMapPropagator()
		if propagator != nil {
			ctx = propagator.Extract(ctx, propagation.HeaderCarrier(req.Header))
		}

		spanName := req.Method + " " + req.URL.Path
		ctx, span := tracer.Start(
			ctx,
			spanName,
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(
				attribute.String("http.request.method", req.Method),
				attribute.String("url.path", req.URL.Path),
			),
		)
		defer span.End()

		recorder := &statusCapturingResponseWriter{ResponseWriter: w}
		req = req.WithContext(ctx)
		next.ServeHTTP(recorder, req)

		if routePattern == "" {
			routePattern = strings.TrimSpace(req.Pattern)
		}
		if routePattern != "" {
			span.SetName(req.Method + " " + routePattern)
			span.SetAttributes(attribute.String("http.route", routePattern))
		}
		statusCode := recorder.status()
		span.SetAttributes(attribute.Int("http.response.status_code", statusCode))
		if statusCode >= http.StatusInternalServerError {
			span.SetStatus(codes.Error, http.StatusText(statusCode))
		}
		observeHTTPRequestMetrics(req, routePattern, statusCode, time.Since(start), requestBytes, recorder.bytesWritten)
	})
}

func shouldAutoMigrateGenerationStoreTarget(target string) bool {
	switch strings.TrimSpace(strings.ToLower(target)) {
	case config.TargetAll, config.TargetIngester:
		return true
	default:
		return false
	}
}

func buildGenerationStore(ctx context.Context, cfg config.Config, autoMigrate bool) (generationingest.Store, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.StorageBackend)) {
	case "", "mysql":
		store, err := mysql.NewWALStore(cfg.MySQLDSN)
		if err != nil {
			return nil, fmt.Errorf("create mysql wal store: %w", err)
		}
		if autoMigrate {
			if err := store.AutoMigrate(ctx); err != nil {
				return nil, err
			}
		}
		return store, nil
	default:
		return nil, fmt.Errorf("unsupported storage backend %q", cfg.StorageBackend)
	}
}

func buildFeedbackStore(storageBackend string, generationStore generationingest.Store) (feedback.Store, error) {
	if store, ok := generationStore.(feedback.Store); ok {
		return store, nil
	}
	return nil, fmt.Errorf("storage backend %q does not support feedback storage", storageBackend)
}

func buildBlockReader(ctx context.Context, cfg config.ObjectStoreConfig) (storage.BlockReader, error) {
	return newObjectBlockReader(ctx, cfg)
}

func buildScoreGenerationLookup(hotReader storage.WALReader, blockMetadataStore storage.BlockMetadataStore, blockReader storage.BlockReader) evalingest.GenerationLookup {
	return evalworker.NewHotColdGenerationReader(hotReader, blockMetadataStore, blockReader)
}

type evalSeedStateStore interface {
	ListEvaluators(ctx context.Context, tenantID string, limit int, cursor uint64) ([]evalpkg.EvaluatorDefinition, uint64, error)
	ListRules(ctx context.Context, tenantID string, limit int, cursor uint64) ([]evalpkg.RuleDefinition, uint64, error)
}

func shouldLoadEvalSeed(ctx context.Context, store evalSeedStateStore, tenantID string) (bool, error) {
	if store == nil {
		return false, nil
	}
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return false, nil
	}

	evaluators, _, err := store.ListEvaluators(ctx, trimmedTenantID, 1, 0)
	if err != nil {
		return false, fmt.Errorf("list evaluators for seed bootstrap check: %w", err)
	}
	if len(evaluators) > 0 {
		return false, nil
	}

	rules, _, err := store.ListRules(ctx, trimmedTenantID, 1, 0)
	if err != nil {
		return false, fmt.Errorf("list rules for seed bootstrap check: %w", err)
	}
	return len(rules) == 0, nil
}

type judgeDiscoveryAdapter struct {
	discovery *judges.Discovery
}

type evalHookAdapter struct {
	notifier evalEnqueueNotifier
}

func (a evalHookAdapter) OnGenerationsSaved(_ string) {
	if a.notifier == nil {
		return
	}
	a.notifier.Notify()
}

type evalEnqueueNotifier interface {
	Notify()
}

type evalEnqueueStoreAdapter struct {
	store *mysql.WALStore
}

func (a evalEnqueueStoreAdapter) ClaimEvalEnqueueEvents(ctx context.Context, now time.Time, limit int, claimTTL time.Duration) ([]evalenqueue.Event, error) {
	if a.store == nil {
		return []evalenqueue.Event{}, nil
	}

	rows, err := a.store.ClaimEvalEnqueueEvents(ctx, now, limit, claimTTL)
	if err != nil {
		return nil, err
	}

	out := make([]evalenqueue.Event, 0, len(rows))
	for _, row := range rows {
		out = append(out, evalenqueue.Event{
			TenantID:       row.TenantID,
			GenerationID:   row.GenerationID,
			ConversationID: row.ConversationID,
			Payload:        row.Payload,
			Attempts:       row.Attempts,
		})
	}
	return out, nil
}

func (a evalEnqueueStoreAdapter) CompleteEvalEnqueueEvent(ctx context.Context, tenantID, generationID string) error {
	if a.store == nil {
		return nil
	}
	return a.store.CompleteEvalEnqueueEvent(ctx, tenantID, generationID)
}

func (a evalEnqueueStoreAdapter) RequeueClaimedEvalEnqueueEvent(ctx context.Context, tenantID, generationID string) error {
	if a.store == nil {
		return nil
	}
	return a.store.RequeueClaimedEvalEnqueueEvent(ctx, tenantID, generationID)
}

func (a evalEnqueueStoreAdapter) FailEvalEnqueueEvent(ctx context.Context, tenantID, generationID, lastError string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error) {
	if a.store == nil {
		return false, nil
	}
	return a.store.FailEvalEnqueueEvent(ctx, tenantID, generationID, lastError, retryAt, maxAttempts, permanent)
}

type evalEnqueueProcessorAdapter struct {
	engine *evalrules.Engine
}

func (a evalEnqueueProcessorAdapter) Process(ctx context.Context, event evalenqueue.Event) error {
	if a.engine == nil {
		return nil
	}

	// Durable enqueue events must observe the most recent control-plane config.
	// Invalidate tenant cache before each event so rule/evaluator changes apply
	// immediately and events are not completed against stale snapshots.
	a.engine.InvalidateTenantCache(event.TenantID)
	return a.engine.OnGenerationsSaved(ctx, event.TenantID, []evalrules.GenerationRow{{
		GenerationID:   event.GenerationID,
		ConversationID: event.ConversationID,
		Payload:        event.Payload,
	}})
}

func (a judgeDiscoveryAdapter) ListProviders(ctx context.Context) []evalcontrol.JudgeProvider {
	if a.discovery == nil {
		return []evalcontrol.JudgeProvider{}
	}
	providers := a.discovery.ListProviders(ctx)
	out := make([]evalcontrol.JudgeProvider, 0, len(providers))
	for _, provider := range providers {
		out = append(out, evalcontrol.JudgeProvider{
			ID:   provider.ID,
			Name: provider.Name,
			Type: provider.Type,
		})
	}
	return out
}

func (a judgeDiscoveryAdapter) ListModels(ctx context.Context, providerID string) ([]evalcontrol.JudgeModel, error) {
	if a.discovery == nil {
		return []evalcontrol.JudgeModel{}, nil
	}
	models, err := a.discovery.ListModels(ctx, providerID)
	if err != nil {
		return nil, err
	}
	out := make([]evalcontrol.JudgeModel, 0, len(models))
	for _, model := range models {
		out = append(out, evalcontrol.JudgeModel{
			ID:            model.ID,
			Name:          model.Name,
			Provider:      model.Provider,
			ContextWindow: model.ContextWindow,
		})
	}
	return out, nil
}
