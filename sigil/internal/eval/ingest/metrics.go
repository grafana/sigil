package ingest

import (
	"context"
	"strings"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	scoreIngestBatchSize = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_ingest_scores_batch_size",
		Help:    "Score ingest batch size by transport.",
		Buckets: []float64{1, 2, 5, 10, 20, 50, 100, 250, 500, 1000},
	}, []string{"transport"})
	scoreIngestItemsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_ingest_scores_items_total",
		Help: "Score ingest outcomes by tenant, status, reason, and transport.",
	}, []string{"tenant_id", "status", "reason", "transport"})
)

type scoreIngestTransportContextKey struct{}

func withTransport(ctx context.Context, transport string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, scoreIngestTransportContextKey{}, normalizeTransport(transport))
}

func transportFromContext(ctx context.Context) string {
	if ctx == nil {
		return "unknown"
	}
	value, _ := ctx.Value(scoreIngestTransportContextKey{}).(string)
	return normalizeTransport(value)
}

func observeScoreIngestBatch(transport string, size int) {
	if size < 0 {
		size = 0
	}
	scoreIngestBatchSize.WithLabelValues(normalizeTransport(transport)).Observe(float64(size))
}

func observeScoreIngestItem(tenantID string, accepted bool, reason string, transport string) {
	status := "rejected"
	if accepted {
		status = "accepted"
	}
	scoreIngestItemsTotal.WithLabelValues(metricTenantID(tenantID), status, normalizeReason(reason), normalizeTransport(transport)).Inc()
}

func metricTenantID(tenantID string) string {
	trimmed := strings.TrimSpace(tenantID)
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
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
