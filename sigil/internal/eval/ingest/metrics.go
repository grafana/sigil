package ingest

import (
	"context"

	"github.com/grafana/sigil/sigil/internal/metriclabels"
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
	return context.WithValue(ctx, scoreIngestTransportContextKey{}, metriclabels.Transport(transport))
}

func transportFromContext(ctx context.Context) string {
	if ctx == nil {
		return "unknown"
	}
	value, _ := ctx.Value(scoreIngestTransportContextKey{}).(string)
	return metriclabels.Transport(value)
}

func observeScoreIngestBatch(transport string, size int) {
	if size < 0 {
		size = 0
	}
	scoreIngestBatchSize.WithLabelValues(metriclabels.Transport(transport)).Observe(float64(size))
}

func observeScoreIngestItem(tenantID string, accepted bool, reason string, transport string) {
	status := "rejected"
	if accepted {
		status = "accepted"
	}
	scoreIngestItemsTotal.WithLabelValues(metriclabels.TenantID(tenantID), status, metriclabels.Reason(reason), metriclabels.Transport(transport)).Inc()
}
