package generation

import (
	"context"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/metriclabels"
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
	return context.WithValue(ctx, generationTransportContextKey{}, metriclabels.Transport(transport))
}

func transportFromContext(ctx context.Context) string {
	if ctx == nil {
		return "unknown"
	}
	value, _ := ctx.Value(generationTransportContextKey{}).(string)
	return metriclabels.Transport(value)
}

func observeGenerationBatchSize(transport string, size int) {
	if size < 0 {
		size = 0
	}
	generationIngestBatchSize.WithLabelValues(metriclabels.Transport(transport)).Observe(float64(size))
}

func observeGenerationItemOutcome(tenantID string, mode sigilv1.GenerationMode, accepted bool, reason string, transport string) {
	status := "rejected"
	if accepted {
		status = "accepted"
	}
	generationIngestItemsTotal.WithLabelValues(
		metriclabels.TenantID(tenantID),
		generationModeLabel(mode),
		status,
		metriclabels.Reason(reason),
		metriclabels.Transport(transport),
	).Inc()
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
