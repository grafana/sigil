package telemetry

import (
	"context"
	"errors"
	"testing"

	"github.com/go-kit/log"
	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestTraceExportEnabledFromEnv(t *testing.T) {
	t.Run("sdk disabled", func(t *testing.T) {
		t.Setenv("OTEL_SDK_DISABLED", "true")
		t.Setenv("OTEL_TRACES_EXPORTER", "otlp")
		enabled, reason := traceExportEnabledFromEnv()
		if enabled {
			t.Fatalf("expected disabled tracing export")
		}
		if reason != reasonDisabledBySDK {
			t.Fatalf("expected reason %q, got %q", reasonDisabledBySDK, reason)
		}
	})

	t.Run("none exporter", func(t *testing.T) {
		t.Setenv("OTEL_SDK_DISABLED", "")
		t.Setenv("OTEL_TRACES_EXPORTER", "none")
		enabled, reason := traceExportEnabledFromEnv()
		if enabled {
			t.Fatalf("expected disabled tracing export")
		}
		if reason != reasonExporterNone {
			t.Fatalf("expected reason %q, got %q", reasonExporterNone, reason)
		}
	})

	t.Run("explicit exporter", func(t *testing.T) {
		t.Setenv("OTEL_SDK_DISABLED", "")
		t.Setenv("OTEL_TRACES_EXPORTER", "otlp")
		enabled, reason := traceExportEnabledFromEnv()
		if !enabled {
			t.Fatalf("expected enabled tracing export")
		}
		if reason != reasonExporterSet {
			t.Fatalf("expected reason %q, got %q", reasonExporterSet, reason)
		}
	})

	t.Run("otlp endpoint only", func(t *testing.T) {
		t.Setenv("OTEL_SDK_DISABLED", "")
		t.Setenv("OTEL_TRACES_EXPORTER", "")
		t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
		enabled, reason := traceExportEnabledFromEnv()
		if !enabled {
			t.Fatalf("expected enabled tracing export")
		}
		if reason != reasonOTLPEndpointSet {
			t.Fatalf("expected reason %q, got %q", reasonOTLPEndpointSet, reason)
		}
	})

	t.Run("not configured", func(t *testing.T) {
		t.Setenv("OTEL_SDK_DISABLED", "")
		t.Setenv("OTEL_TRACES_EXPORTER", "")
		t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
		t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "")
		enabled, reason := traceExportEnabledFromEnv()
		if enabled {
			t.Fatalf("expected disabled tracing export")
		}
		if reason != reasonExporterUnset {
			t.Fatalf("expected reason %q, got %q", reasonExporterUnset, reason)
		}
	})
}

func TestInitTracingDisabledSkipsFactory(t *testing.T) {
	t.Setenv("OTEL_SDK_DISABLED", "")
	t.Setenv("OTEL_TRACES_EXPORTER", "none")

	previousFactory := spanExporterFactory
	t.Cleanup(func() {
		spanExporterFactory = previousFactory
	})

	factoryCalled := false
	spanExporterFactory = func(context.Context, ...autoexport.SpanOption) (sdktrace.SpanExporter, error) {
		factoryCalled = true
		return &testSpanExporter{}, nil
	}

	shutdown, state := InitTracing(context.Background(), log.NewNopLogger())
	if state.Enabled {
		t.Fatalf("expected tracing disabled state")
	}
	if factoryCalled {
		t.Fatalf("expected exporter factory to be skipped")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("expected no-op shutdown to return nil, got %v", err)
	}
}

func TestInitTracingFailOpenOnExporterInitError(t *testing.T) {
	t.Setenv("OTEL_SDK_DISABLED", "")
	t.Setenv("OTEL_TRACES_EXPORTER", "otlp")

	previousFactory := spanExporterFactory
	t.Cleanup(func() {
		spanExporterFactory = previousFactory
	})
	spanExporterFactory = func(context.Context, ...autoexport.SpanOption) (sdktrace.SpanExporter, error) {
		return nil, errors.New("boom")
	}

	shutdown, state := InitTracing(context.Background(), log.NewNopLogger())
	if state.Enabled {
		t.Fatalf("expected tracing disabled on exporter init failure")
	}
	if state.Reason != reasonExporterInitError {
		t.Fatalf("expected reason %q, got %q", reasonExporterInitError, state.Reason)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("expected no-op shutdown to return nil, got %v", err)
	}
}

func TestInitTracingSetsGlobalProviderAndPropagator(t *testing.T) {
	t.Setenv("OTEL_SDK_DISABLED", "")
	t.Setenv("OTEL_TRACES_EXPORTER", "otlp")

	previousFactory := spanExporterFactory
	previousProvider := otel.GetTracerProvider()
	previousPropagator := otel.GetTextMapPropagator()

	exporter := &testSpanExporter{}
	spanExporterFactory = func(context.Context, ...autoexport.SpanOption) (sdktrace.SpanExporter, error) {
		return exporter, nil
	}

	t.Cleanup(func() {
		spanExporterFactory = previousFactory
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})

	shutdown, state := InitTracing(context.Background(), log.NewNopLogger())
	if !state.Enabled {
		t.Fatalf("expected tracing enabled")
	}

	spanCtx, span := otel.Tracer("test").Start(context.Background(), "test-span")
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(spanCtx, carrier)
	span.End()

	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("unexpected shutdown error: %v", err)
	}
	if !exporter.shutdownCalled {
		t.Fatalf("expected exporter shutdown to be called")
	}

	if carrier.Get("traceparent") == "" {
		t.Fatalf("expected traceparent header to be injected")
	}
}

type testSpanExporter struct {
	shutdownCalled bool
}

func (e *testSpanExporter) ExportSpans(context.Context, []sdktrace.ReadOnlySpan) error {
	return nil
}

func (e *testSpanExporter) Shutdown(context.Context) error {
	e.shutdownCalled = true
	return nil
}
