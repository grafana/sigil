package generation

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/grafana/dskit/user"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

const testTenantID = "tenant-a"

func TestServiceExportAcceptsValidBatch(t *testing.T) {
	store := NewMemoryStore()
	svc := NewService(store)

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-1",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}})

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected accepted result, got error %q", response.Results[0].Error)
	}
	if response.Results[0].GenerationId != "gen-1" {
		t.Fatalf("expected generation id gen-1, got %q", response.Results[0].GenerationId)
	}

	stored, ok := store.Get(testTenantID, "gen-1")
	if !ok {
		t.Fatalf("expected generation in store")
	}
	if stored.Mode != sigilv1.GenerationMode_GENERATION_MODE_SYNC {
		t.Fatalf("expected stored mode sync")
	}
}

func TestServiceExportEmitsTracingSpans(t *testing.T) {
	store := NewMemoryStore()
	svc := NewService(store)

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

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-trace",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}})
	if len(response.Results) != 1 || !response.Results[0].Accepted {
		t.Fatalf("expected accepted export response, got %#v", response.Results)
	}

	spans := spanRecorder.Ended()
	if len(spans) == 0 {
		t.Fatalf("expected ended spans")
	}

	var exportSpan sdktrace.ReadOnlySpan
	var saveBatchSpan sdktrace.ReadOnlySpan
	for _, span := range spans {
		switch span.Name() {
		case "sigil.generation.export":
			exportSpan = span
		case "sigil.generation.store.save_batch":
			saveBatchSpan = span
		}
	}
	if exportSpan == nil {
		t.Fatalf("expected export span, got spans=%d", len(spans))
	}
	if saveBatchSpan == nil {
		t.Fatalf("expected save batch span, got spans=%d", len(spans))
	}
	if saveBatchSpan.Parent().SpanID() != exportSpan.SpanContext().SpanID() {
		t.Fatalf("expected save batch span to be child of export span")
	}
}

func TestServiceExportRejectsInvalidGeneration(t *testing.T) {
	svc := NewService(NewMemoryStore())

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-invalid",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Name: "gpt-5"},
		},
	}})

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if response.Results[0].Accepted {
		t.Fatalf("expected rejected result")
	}
	if response.Results[0].Error != "generation.model.provider is required" {
		t.Fatalf("unexpected error: %q", response.Results[0].Error)
	}
}

func TestServiceExportDefaultsModeAndID(t *testing.T) {
	store := NewMemoryStore()
	svc := NewService(store)

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Model: &sigilv1.ModelRef{Provider: "anthropic", Name: "claude-sonnet-4-5"},
		},
	}})

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected accepted result, got error %q", response.Results[0].Error)
	}
	if response.Results[0].GenerationId == "" {
		t.Fatalf("expected generated id")
	}

	stored, ok := store.Get(testTenantID, response.Results[0].GenerationId)
	if !ok {
		t.Fatalf("expected generation in store")
	}
	if stored.Mode != sigilv1.GenerationMode_GENERATION_MODE_SYNC {
		t.Fatalf("expected default mode sync")
	}
	if stored.OperationName != defaultOperationNameSync {
		t.Fatalf("expected default operation %q, got %q", defaultOperationNameSync, stored.OperationName)
	}
}

func TestServiceExportDefaultsOperationByMode(t *testing.T) {
	store := NewMemoryStore()
	svc := NewService(store)

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-stream-default-op",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_STREAM,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}})

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected accepted result, got error %q", response.Results[0].Error)
	}

	stored, ok := store.Get(testTenantID, "gen-stream-default-op")
	if !ok {
		t.Fatalf("expected generation in store")
	}
	if stored.OperationName != defaultOperationNameStream {
		t.Fatalf("expected default operation %q, got %q", defaultOperationNameStream, stored.OperationName)
	}
}

func TestServiceExportReturnsPartialFailures(t *testing.T) {
	svc := NewService(&failingStore{errIndexes: map[int]error{1: errors.New("persist generation")}})

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{Id: "gen-1", Mode: sigilv1.GenerationMode_GENERATION_MODE_SYNC, Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"}},
		{Id: "gen-2", Mode: sigilv1.GenerationMode_GENERATION_MODE_STREAM, Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"}},
	}})

	if len(response.Results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected first generation accepted, got %q", response.Results[0].Error)
	}
	if response.Results[1].Accepted {
		t.Fatalf("expected second generation rejected")
	}
	if response.Results[1].Error != "persist generation" {
		t.Fatalf("unexpected error: %q", response.Results[1].Error)
	}
}

func TestServiceExportSurvivesCallerCancellationDuringStoreWrite(t *testing.T) {
	store := &blockingStore{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	svc := NewService(store)

	ctx, cancel := context.WithCancel(tenantContext())
	defer cancel()

	done := make(chan *sigilv1.ExportGenerationsResponse, 1)
	go func() {
		done <- svc.Export(ctx, &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
			{
				Id:    "gen-cancel",
				Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
				Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
			},
		}})
	}()

	select {
	case <-store.started:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for store write to start")
	}

	cancel()
	close(store.release)

	select {
	case response := <-done:
		if len(response.Results) != 1 {
			t.Fatalf("expected 1 result, got %d", len(response.Results))
		}
		if !response.Results[0].Accepted {
			t.Fatalf("expected accepted result after detached persistence, got %q", response.Results[0].Error)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for export response")
	}
}

type failingStore struct {
	errIndexes map[int]error
}

func (s *failingStore) SaveBatch(_ context.Context, _ string, generations []*sigilv1.Generation) []error {
	errs := make([]error, len(generations))
	for i := range generations {
		if err, ok := s.errIndexes[i]; ok {
			errs[i] = err
		}
	}
	return errs
}

type blockingStore struct {
	started chan struct{}
	release chan struct{}
}

func (s *blockingStore) SaveBatch(ctx context.Context, _ string, generations []*sigilv1.Generation) []error {
	close(s.started)
	<-s.release

	errs := make([]error, len(generations))
	if err := ctx.Err(); err != nil {
		for i := range errs {
			errs[i] = err
		}
	}
	return errs
}

func TestServiceExportRejectsMissingTenant(t *testing.T) {
	svc := NewService(NewMemoryStore())

	response := svc.Export(context.Background(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-no-tenant",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}})

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if response.Results[0].Accepted {
		t.Fatalf("expected rejected result")
	}
	if response.Results[0].Error == "" {
		t.Fatalf("expected missing tenant error")
	}
}

func TestServiceExportEmitsIngestMetrics(t *testing.T) {
	svc := NewService(NewMemoryStore())
	ctx := withTransport(tenantContext(), "http")

	acceptedBefore := testutil.ToFloat64(generationIngestItemsTotal.WithLabelValues("tenant-a", "sync", "accepted", "none", "http"))
	rejectedBefore := testutil.ToFloat64(generationIngestItemsTotal.WithLabelValues("tenant-a", "sync", "rejected", "validation", "http"))

	response := svc.Export(ctx, &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-metrics-ok",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
		{
			Id:    "gen-metrics-bad",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Name: "gpt-5"},
		},
	}})
	if len(response.Results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(response.Results))
	}

	acceptedAfter := testutil.ToFloat64(generationIngestItemsTotal.WithLabelValues("tenant-a", "sync", "accepted", "none", "http"))
	rejectedAfter := testutil.ToFloat64(generationIngestItemsTotal.WithLabelValues("tenant-a", "sync", "rejected", "validation", "http"))

	if delta := acceptedAfter - acceptedBefore; delta != 1 {
		t.Fatalf("expected one accepted metric increment, got %v", delta)
	}
	if delta := rejectedAfter - rejectedBefore; delta != 1 {
		t.Fatalf("expected one rejected metric increment, got %v", delta)
	}
}

func TestServiceExportClassifiesStoreCancellationReasons(t *testing.T) {
	svc := NewService(&failingStore{errIndexes: map[int]error{
		0: context.Canceled,
		1: context.DeadlineExceeded,
		2: errors.New("persist generation"),
	}})
	ctx := withTransport(tenantContext(), "http")

	canceledBefore := testutil.ToFloat64(generationIngestItemsTotal.WithLabelValues("tenant-a", "sync", "rejected", "canceled", "http"))
	timeoutBefore := testutil.ToFloat64(generationIngestItemsTotal.WithLabelValues("tenant-a", "sync", "rejected", "timeout", "http"))
	storeErrorBefore := testutil.ToFloat64(generationIngestItemsTotal.WithLabelValues("tenant-a", "sync", "rejected", "store_error", "http"))

	response := svc.Export(ctx, &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{Id: "gen-canceled", Mode: sigilv1.GenerationMode_GENERATION_MODE_SYNC, Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"}},
		{Id: "gen-timeout", Mode: sigilv1.GenerationMode_GENERATION_MODE_SYNC, Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"}},
		{Id: "gen-store-error", Mode: sigilv1.GenerationMode_GENERATION_MODE_SYNC, Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"}},
	}})
	if len(response.Results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(response.Results))
	}

	canceledAfter := testutil.ToFloat64(generationIngestItemsTotal.WithLabelValues("tenant-a", "sync", "rejected", "canceled", "http"))
	timeoutAfter := testutil.ToFloat64(generationIngestItemsTotal.WithLabelValues("tenant-a", "sync", "rejected", "timeout", "http"))
	storeErrorAfter := testutil.ToFloat64(generationIngestItemsTotal.WithLabelValues("tenant-a", "sync", "rejected", "store_error", "http"))

	if delta := canceledAfter - canceledBefore; delta != 1 {
		t.Fatalf("expected one canceled increment, got %v", delta)
	}
	if delta := timeoutAfter - timeoutBefore; delta != 1 {
		t.Fatalf("expected one timeout increment, got %v", delta)
	}
	if delta := storeErrorAfter - storeErrorBefore; delta != 1 {
		t.Fatalf("expected one store_error increment, got %v", delta)
	}
}

func tenantContext() context.Context {
	return user.InjectOrgID(context.Background(), testTenantID)
}
