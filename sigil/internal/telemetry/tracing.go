package telemetry

import (
	"context"
	"os"
	"strconv"
	"strings"

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const (
	reasonDisabledBySDK     = "otel_sdk_disabled"
	reasonExporterNone      = "traces_exporter_none"
	reasonExporterSet       = "traces_exporter_set"
	reasonOTLPEndpointSet   = "otlp_endpoint_set"
	reasonExporterUnset     = "traces_exporter_not_configured"
	reasonExporterInitError = "tracing_init_failed"
)

var spanExporterFactory = autoexport.NewSpanExporter

type TracingState struct {
	Enabled bool
	Reason  string
}

func InitTracing(ctx context.Context, logger log.Logger) (func(context.Context) error, TracingState) {
	if logger == nil {
		logger = log.NewNopLogger()
	}
	if ctx == nil {
		ctx = context.Background()
	}

	enabled, reason := traceExportEnabledFromEnv()
	if !enabled {
		_ = level.Info(logger).Log("msg", "sigil tracing export disabled", "reason", reason)
		return noOpShutdown, TracingState{Enabled: false, Reason: reason}
	}

	exporter, err := spanExporterFactory(ctx)
	if err != nil {
		_ = level.Warn(logger).Log("msg", "sigil tracing export init failed; continuing without exporter", "err", err, "reason", reason)
		return noOpShutdown, TracingState{Enabled: false, Reason: reasonExporterInitError}
	}
	if autoexport.IsNoneSpanExporter(exporter) {
		_ = level.Info(logger).Log("msg", "sigil tracing export disabled", "reason", reasonExporterNone)
		return noOpShutdown, TracingState{Enabled: false, Reason: reasonExporterNone}
	}

	tracerProvider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter))
	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	_ = level.Info(logger).Log("msg", "sigil tracing export enabled", "reason", reason)

	return func(shutdownCtx context.Context) error {
		if shutdownCtx == nil {
			shutdownCtx = context.Background()
		}
		return tracerProvider.Shutdown(shutdownCtx)
	}, TracingState{Enabled: true, Reason: reason}
}

func traceExportEnabledFromEnv() (bool, string) {
	if getenvBool("OTEL_SDK_DISABLED") {
		return false, reasonDisabledBySDK
	}

	exporters := splitCSVLower(os.Getenv("OTEL_TRACES_EXPORTER"))
	if len(exporters) > 0 {
		if len(exporters) == 1 && exporters[0] == "none" {
			return false, reasonExporterNone
		}
		return true, reasonExporterSet
	}

	if strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")) != "" ||
		strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")) != "" {
		return true, reasonOTLPEndpointSet
	}

	return false, reasonExporterUnset
}

func getenvBool(key string) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return false
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return false
	}
	return enabled
}

func splitCSVLower(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		item := strings.ToLower(strings.TrimSpace(part))
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func noOpShutdown(context.Context) error {
	return nil
}
