package sigil

import (
	"context"
	"errors"
	"hash/fnv"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-kit/log"
	"github.com/grafana/sigil/sigil/internal/config"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	evalenqueue "github.com/grafana/sigil/sigil/internal/eval/enqueue"
	evalrules "github.com/grafana/sigil/sigil/internal/eval/rules"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestBuildGenerationStoreRejectsMemoryBackend(t *testing.T) {
	_, err := buildGenerationStore(context.Background(), config.Config{
		Target:         config.TargetServer,
		StorageBackend: "memory",
	}, shouldAutoMigrateGenerationStoreTarget(config.TargetServer))
	if err == nil {
		t.Fatalf("expected unsupported backend error")
	}
	if !strings.Contains(err.Error(), "unsupported storage backend") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildFeedbackStoreRejectsNonFeedbackStore(t *testing.T) {
	_, err := buildFeedbackStore("mysql", generationingest.NewMemoryStore())
	if err == nil {
		t.Fatalf("expected feedback store compatibility error")
	}
	if !strings.Contains(err.Error(), "does not support feedback storage") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildScoreGenerationLookupFallsBackToColdTier(t *testing.T) {
	lookup := buildScoreGenerationLookup(
		&scoreLookupWALReaderStub{},
		&scoreLookupMetadataStoreStub{
			blocks: []storage.BlockMeta{{BlockID: "block-1"}},
		},
		&scoreLookupBlockReaderStub{
			indexByBlock: map[string]*storage.BlockIndex{
				"block-1": {
					Entries: []storage.IndexEntry{{
						GenerationIDHash: hashIDForTest("gen-cold"),
						Offset:           10,
						Length:           100,
					}},
				},
			},
			generationsByBlock: map[string][]*sigilv1.Generation{
				"block-1": {{Id: "gen-cold"}},
			},
		},
	)
	if lookup == nil {
		t.Fatalf("expected non-nil lookup")
	}

	generation, err := lookup.GetByID(context.Background(), "tenant-a", "gen-cold")
	if err != nil {
		t.Fatalf("expected cold lookup to succeed, got %v", err)
	}
	if generation == nil || generation.GetId() != "gen-cold" {
		t.Fatalf("expected cold generation gen-cold, got %#v", generation)
	}
}

type scoreLookupWALReaderStub struct{}

func (s *scoreLookupWALReaderStub) GetByID(context.Context, string, string) (*sigilv1.Generation, error) {
	return nil, nil
}

func (s *scoreLookupWALReaderStub) GetByConversationID(context.Context, string, string) ([]*sigilv1.Generation, error) {
	return []*sigilv1.Generation{}, nil
}

type scoreLookupMetadataStoreStub struct {
	blocks []storage.BlockMeta
}

func (s *scoreLookupMetadataStoreStub) InsertBlock(context.Context, storage.BlockMeta) error {
	return nil
}

func (s *scoreLookupMetadataStoreStub) ListBlocks(context.Context, string, time.Time, time.Time) ([]storage.BlockMeta, error) {
	return append([]storage.BlockMeta(nil), s.blocks...), nil
}

type scoreLookupBlockReaderStub struct {
	indexByBlock       map[string]*storage.BlockIndex
	generationsByBlock map[string][]*sigilv1.Generation
}

func (s *scoreLookupBlockReaderStub) ReadIndex(_ context.Context, _ string, blockID string) (*storage.BlockIndex, error) {
	index, ok := s.indexByBlock[blockID]
	if !ok {
		return &storage.BlockIndex{Entries: []storage.IndexEntry{}}, nil
	}
	return index, nil
}

func (s *scoreLookupBlockReaderStub) ReadGenerations(_ context.Context, _ string, blockID string, _ []storage.IndexEntry) ([]*sigilv1.Generation, error) {
	generations, ok := s.generationsByBlock[blockID]
	if !ok {
		return []*sigilv1.Generation{}, nil
	}
	return generations, nil
}

func hashIDForTest(value string) uint64 {
	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(value))
	return hasher.Sum64()
}

func TestShouldLoadEvalSeed(t *testing.T) {
	testCases := []struct {
		name              string
		store             evalSeedStateStore
		tenantID          string
		expectedLoad      bool
		expectedErrSubstr string
	}{
		{
			name:         "nil store skips",
			store:        nil,
			tenantID:     "tenant-a",
			expectedLoad: false,
		},
		{
			name:         "empty tenant skips",
			store:        &evalSeedStateStoreStub{},
			tenantID:     "",
			expectedLoad: false,
		},
		{
			name: "loads when tenant has no config",
			store: &evalSeedStateStoreStub{
				evaluators: []evalpkg.EvaluatorDefinition{},
				rules:      []evalpkg.RuleDefinition{},
			},
			tenantID:     "tenant-a",
			expectedLoad: true,
		},
		{
			name: "skips when evaluators already exist",
			store: &evalSeedStateStoreStub{
				evaluators: []evalpkg.EvaluatorDefinition{{EvaluatorID: "custom.eval"}},
			},
			tenantID:     "tenant-a",
			expectedLoad: false,
		},
		{
			name: "skips when rules already exist",
			store: &evalSeedStateStoreStub{
				rules: []evalpkg.RuleDefinition{{RuleID: "custom.rule"}},
			},
			tenantID:     "tenant-a",
			expectedLoad: false,
		},
		{
			name: "returns evaluator listing errors",
			store: &evalSeedStateStoreStub{
				listEvaluatorsErr: errors.New("boom"),
			},
			tenantID:          "tenant-a",
			expectedErrSubstr: "list evaluators",
		},
		{
			name: "returns rule listing errors",
			store: &evalSeedStateStoreStub{
				listRulesErr: errors.New("boom"),
			},
			tenantID:          "tenant-a",
			expectedErrSubstr: "list rules",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			load, err := shouldLoadEvalSeed(context.Background(), testCase.store, testCase.tenantID)
			if testCase.expectedErrSubstr != "" {
				if err == nil || !strings.Contains(err.Error(), testCase.expectedErrSubstr) {
					t.Fatalf("expected error containing %q, got %v", testCase.expectedErrSubstr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
			if load != testCase.expectedLoad {
				t.Fatalf("expected load=%v, got %v", testCase.expectedLoad, load)
			}
		})
	}
}

func TestStatusCapturingResponseWriterUnwrapAllowsResponseControllerFlush(t *testing.T) {
	base := &flushTrackingResponseWriter{}
	wrapped := &statusCapturingResponseWriter{ResponseWriter: base}

	controller := http.NewResponseController(wrapped)
	if err := controller.Flush(); err != nil {
		t.Fatalf("expected flush to succeed through wrapped writer, got %v", err)
	}
	if !base.flushed {
		t.Fatalf("expected underlying writer Flush to be called")
	}
}

func TestWithHTTPTracingUsesRoutePatternForWildcardRoute(t *testing.T) {
	spanRecorder := tracetest.NewSpanRecorder()
	tracerProvider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spanRecorder))
	prevTracerProvider := otel.GetTracerProvider()
	prevPropagator := otel.GetTextMapPropagator()
	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		_ = tracerProvider.Shutdown(context.Background())
		otel.SetTracerProvider(prevTracerProvider)
		otel.SetTextMapPropagator(prevPropagator)
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/users/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/users/42", nil)
	recorder := httptest.NewRecorder()
	withHTTPTracing(mux).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected status %d, got %d", http.StatusNoContent, recorder.Code)
	}

	endedSpans := spanRecorder.Ended()
	var routeSpan sdktrace.ReadOnlySpan
	for _, span := range endedSpans {
		if span.Name() == "GET /users/{id}" {
			routeSpan = span
			break
		}
	}
	if routeSpan == nil {
		names := make([]string, 0, len(endedSpans))
		for _, span := range endedSpans {
			names = append(names, span.Name())
		}
		t.Fatalf("expected route span name GET /users/{id}, got %v", names)
	}

	foundRouteAttr := false
	for _, attr := range routeSpan.Attributes() {
		if string(attr.Key) == "http.route" && attr.Value.AsString() == "/users/{id}" {
			foundRouteAttr = true
			break
		}
	}
	if !foundRouteAttr {
		t.Fatalf("expected http.route attribute /users/{id}")
	}
}

func TestWithHTTPTracingEmitsHTTPRequestMetrics(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /users/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("ok"))
	})

	before := testutil.ToFloat64(httpRequestsTotal.WithLabelValues("POST", "/users/{id}", "2xx", "unknown"))
	req := httptest.NewRequest(http.MethodPost, "/users/42", strings.NewReader("hello"))
	recorder := httptest.NewRecorder()
	withHTTPTracing(mux).ServeHTTP(recorder, req)
	after := testutil.ToFloat64(httpRequestsTotal.WithLabelValues("POST", "/users/{id}", "2xx", "unknown"))

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, recorder.Code)
	}
	if delta := after - before; delta != 1 {
		t.Fatalf("expected request metric increment of 1, got %v", delta)
	}
}

func TestGRPCUnaryMetricsInterceptorEmitsCounters(t *testing.T) {
	interceptor := grpcMetricsUnaryInterceptor()
	info := &grpc.UnaryServerInfo{FullMethod: "/sigil.v1.GenerationIngestService/ExportGenerations"}
	before := testutil.ToFloat64(grpcServerRequestsTotal.WithLabelValues("sigil.v1.GenerationIngestService", "ExportGenerations", "unary", codes.OK.String()))

	_, err := interceptor(context.Background(), "req", info, func(context.Context, any) (any, error) {
		return "ok", nil
	})
	if err != nil {
		t.Fatalf("unexpected interceptor error: %v", err)
	}
	after := testutil.ToFloat64(grpcServerRequestsTotal.WithLabelValues("sigil.v1.GenerationIngestService", "ExportGenerations", "unary", codes.OK.String()))
	if delta := after - before; delta != 1 {
		t.Fatalf("expected unary request metric increment of 1, got %v", delta)
	}
}

func TestGRPCStreamMetricsInterceptorEmitsErrorCode(t *testing.T) {
	interceptor := grpcMetricsStreamInterceptor()
	info := &grpc.StreamServerInfo{FullMethod: "/sigil.v1.GenerationIngestService/StreamExportGenerations"}
	before := testutil.ToFloat64(grpcServerRequestsTotal.WithLabelValues("sigil.v1.GenerationIngestService", "StreamExportGenerations", "stream", codes.Unauthenticated.String()))

	err := interceptor("srv", nil, info, func(any, grpc.ServerStream) error {
		return status.Error(codes.Unauthenticated, "no tenant")
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated error, got %v", err)
	}
	after := testutil.ToFloat64(grpcServerRequestsTotal.WithLabelValues("sigil.v1.GenerationIngestService", "StreamExportGenerations", "stream", codes.Unauthenticated.String()))
	if delta := after - before; delta != 1 {
		t.Fatalf("expected stream request metric increment of 1, got %v", delta)
	}
}

func TestShouldStartGRPCServer(t *testing.T) {
	registry := newServerTransportRegistry()
	if shouldStartGRPCServer(registry) {
		t.Fatalf("expected grpc server disabled without grpc registrars")
	}

	registry.RegisterGRPC(func(*grpc.Server) {})
	if !shouldStartGRPCServer(registry) {
		t.Fatalf("expected grpc server enabled when grpc registrar is present")
	}
}

func TestServerModuleStartSkipsGRPCWithoutRegistrars(t *testing.T) {
	cfg := config.FromEnv()
	cfg.HTTPAddr = freeLocalAddr(t)
	cfg.OTLPGRPCAddr = freeLocalAddr(t)
	cfg.AuthEnabled = false

	module := &serverModule{
		cfg:      cfg,
		logger:   log.NewNopLogger(),
		registry: newServerTransportRegistry(),
		runErr:   make(chan error, 2),
	}
	if err := module.start(context.Background()); err != nil {
		t.Fatalf("start server module: %v", err)
	}
	t.Cleanup(func() {
		_ = module.stop(nil)
	})

	if module.grpcServer != nil {
		t.Fatalf("expected grpc server to be disabled when no grpc registrars are present")
	}
	if module.grpcListener != nil {
		t.Fatalf("expected grpc listener to be nil when no grpc registrars are present")
	}
}

func freeLocalAddr(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve local addr: %v", err)
	}
	defer func() {
		_ = listener.Close()
	}()
	return listener.Addr().String()
}

func TestEvalEnqueueProcessorAdapterInvalidatesTenantCacheBeforeProcessing(t *testing.T) {
	store := &evalEnqueueProcessorTestStore{
		rules: []evalpkg.RuleDefinition{{
			TenantID:     "tenant-a",
			RuleID:       "rule-1",
			Enabled:      true,
			Selector:     evalpkg.SelectorAllAssistantGenerations,
			Match:        map[string]any{},
			SampleRate:   1,
			EvaluatorIDs: []string{"eval.helpfulness"},
		}},
		evaluatorVersion: "v1",
	}
	engine := evalrules.NewEngine(store)
	adapter := evalEnqueueProcessorAdapter{engine: engine}

	event1 := evalenqueue.Event{
		TenantID:     "tenant-a",
		GenerationID: "gen-1",
		Payload:      marshalEvalTestGeneration(t, "gen-1"),
	}
	if err := adapter.Process(context.Background(), event1); err != nil {
		t.Fatalf("process event1: %v", err)
	}
	if len(store.enqueued) != 1 {
		t.Fatalf("expected one enqueued item after first event, got %d", len(store.enqueued))
	}
	if store.enqueued[0].EvaluatorVersion != "v1" {
		t.Fatalf("expected first event evaluator version v1, got %q", store.enqueued[0].EvaluatorVersion)
	}

	store.evaluatorVersion = "v2"
	event2 := evalenqueue.Event{
		TenantID:     "tenant-a",
		GenerationID: "gen-2",
		Payload:      marshalEvalTestGeneration(t, "gen-2"),
	}
	if err := adapter.Process(context.Background(), event2); err != nil {
		t.Fatalf("process event2: %v", err)
	}
	if len(store.enqueued) != 2 {
		t.Fatalf("expected two enqueued items after second event, got %d", len(store.enqueued))
	}
	if store.enqueued[1].EvaluatorVersion != "v2" {
		t.Fatalf("expected second event to use refreshed evaluator version v2, got %q", store.enqueued[1].EvaluatorVersion)
	}
	if store.listRulesCalls < 2 {
		t.Fatalf("expected per-event cache invalidation to force reload, list rules calls=%d", store.listRulesCalls)
	}
}

func marshalEvalTestGeneration(t *testing.T, generationID string) []byte {
	t.Helper()
	payload, err := proto.Marshal(&sigilv1.Generation{
		Id: generationID,
		Output: []*sigilv1.Message{{
			Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{
				Payload: &sigilv1.Part_Text{Text: "hello"},
			}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal generation: %v", err)
	}
	return payload
}

type evalSeedStateStoreStub struct {
	evaluators        []evalpkg.EvaluatorDefinition
	rules             []evalpkg.RuleDefinition
	listEvaluatorsErr error
	listRulesErr      error
}

type flushTrackingResponseWriter struct {
	header  http.Header
	flushed bool
}

func (w *flushTrackingResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *flushTrackingResponseWriter) Write(data []byte) (int, error) {
	return len(data), nil
}

func (w *flushTrackingResponseWriter) WriteHeader(int) {}

func (w *flushTrackingResponseWriter) Flush() {
	w.flushed = true
}

type evalEnqueueProcessorTestStore struct {
	rules            []evalpkg.RuleDefinition
	evaluatorVersion string
	enqueued         []evalpkg.WorkItem
	listRulesCalls   int
}

func (s *evalEnqueueProcessorTestStore) ListEnabledRules(_ context.Context, _ string) ([]evalpkg.RuleDefinition, error) {
	s.listRulesCalls++
	return append([]evalpkg.RuleDefinition(nil), s.rules...), nil
}

func (s *evalEnqueueProcessorTestStore) GetEvaluator(_ context.Context, _ string, evaluatorID string) (*evalpkg.EvaluatorDefinition, error) {
	if evaluatorID != "eval.helpfulness" {
		return nil, nil
	}
	return &evalpkg.EvaluatorDefinition{
		EvaluatorID: evaluatorID,
		Version:     s.evaluatorVersion,
		Kind:        evalpkg.EvaluatorKindHeuristic,
	}, nil
}

func (s *evalEnqueueProcessorTestStore) EnqueueWorkItem(_ context.Context, item evalpkg.WorkItem) error {
	s.enqueued = append(s.enqueued, item)
	return nil
}

func (s *evalSeedStateStoreStub) ListEvaluators(_ context.Context, _ string, _ int, _ uint64) ([]evalpkg.EvaluatorDefinition, uint64, error) {
	if s.listEvaluatorsErr != nil {
		return nil, 0, s.listEvaluatorsErr
	}
	return append([]evalpkg.EvaluatorDefinition(nil), s.evaluators...), 0, nil
}

func (s *evalSeedStateStoreStub) ListRules(_ context.Context, _ string, _ int, _ uint64) ([]evalpkg.RuleDefinition, uint64, error) {
	if s.listRulesErr != nil {
		return nil, 0, s.listRulesErr
	}
	return append([]evalpkg.RuleDefinition(nil), s.rules...), 0, nil
}
