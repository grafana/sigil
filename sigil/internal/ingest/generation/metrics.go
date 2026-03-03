package generation

import (
	"context"
	"strings"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	generationIngestBatchSize = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_ingest_generation_batch_size",
		Help:    "Generation ingest batch size by transport.",
		Buckets: []float64{1, 2, 5, 10, 20, 50, 100, 250, 500, 1000},
	}, []string{"transport"})
	generationIngestItemsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_ingest_generation_items_total",
		Help: "Generation ingest outcomes by tenant, mode, transport, and reason.",
	}, []string{"tenant_id", "mode", "status", "reason", "transport"})
)

type generationTransportContextKey struct{}

func withTransport(ctx context.Context, transport string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, generationTransportContextKey{}, normalizeTransport(transport))
}

func transportFromContext(ctx context.Context) string {
	if ctx == nil {
		return "unknown"
	}
	value, _ := ctx.Value(generationTransportContextKey{}).(string)
	return normalizeTransport(value)
}

func observeGenerationBatchSize(transport string, size int) {
	if size < 0 {
		size = 0
	}
	generationIngestBatchSize.WithLabelValues(normalizeTransport(transport)).Observe(float64(size))
}

func observeGenerationItemOutcome(tenantID string, mode sigilv1.GenerationMode, accepted bool, reason string, transport string) {
	status := "rejected"
	if accepted {
		status = "accepted"
	}
	generationIngestItemsTotal.WithLabelValues(
		metricTenantLabel(tenantID),
		generationModeLabel(mode),
		status,
		normalizeReason(reason),
		normalizeTransport(transport),
	).Inc()
}

func metricTenantLabel(tenantID string) string {
	trimmed := strings.TrimSpace(tenantID)
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}

func generationModeLabel(mode sigilv1.GenerationMode) string {
	switch mode {
	case sigilv1.GenerationMode_GENERATION_MODE_SYNC:
		return "sync"
	case sigilv1.GenerationMode_GENERATION_MODE_STREAM:
		return "stream"
	default:
		return "unknown"
	}
}

func normalizeReason(reason string) string {
	trimmed := strings.TrimSpace(reason)
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}

func normalizeTransport(transport string) string {
	switch strings.ToLower(strings.TrimSpace(transport)) {
	case "http":
		return "http"
	case "grpc":
		return "grpc"
	default:
		return "unknown"
	}
}
