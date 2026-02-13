package compactor

import (
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	compactorRunsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_compactor_runs_total",
		Help: "Total number of compactor loop runs partitioned by phase and status.",
	}, []string{"phase", "status"})
	compactorBlocksCreatedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sigil_compactor_blocks_created_total",
		Help: "Total number of compacted blocks created by the compactor.",
	})
	compactorGenerationsCompactedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sigil_compactor_generations_compacted_total",
		Help: "Total number of generations compacted into object storage blocks.",
	})
	compactorTruncatedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sigil_compactor_truncated_total",
		Help: "Total number of compacted rows truncated from hot storage.",
	})
	compactorDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_compactor_duration_seconds",
		Help:    "Compactor phase duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"phase"})
	compactorLeaseHeld = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sigil_compactor_lease_held",
		Help: "Whether the compactor currently holds a lease for the tenant shard (1=true, 0=false).",
	}, []string{"tenant_id", "shard_id"})
	compactorClaimBatchTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_compactor_claim_batch_total",
		Help: "Total number of claim batch attempts by status.",
	}, []string{"status"})
	compactorClaimStaleRecoveredTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sigil_compactor_claim_stale_recovered_total",
		Help: "Total number of stale claimed rows recovered.",
	})
	compactorWorkerActive = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "sigil_compactor_worker_active",
		Help: "Current number of active compactor workers.",
	})
	compactorShardBacklog = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sigil_compactor_shard_backlog",
		Help: "Backlog rows discovered for each tenant shard.",
	}, []string{"tenant_id", "shard_id"})
	compactorDrainDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_compactor_drain_duration_seconds",
		Help:    "Time spent draining a tenant shard in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"tenant_id", "shard_id"})
	compactorSweepDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "sigil_compactor_claim_sweep_duration_seconds",
		Help:    "Duration of stale claim sweep in seconds.",
		Buckets: prometheus.DefBuckets,
	})
)

func observeRunMetrics(phase, status string, start time.Time) {
	compactorRunsTotal.WithLabelValues(phase, status).Inc()
	compactorDuration.WithLabelValues(phase).Observe(time.Since(start).Seconds())
}

func observeCompacted(count int) {
	if count <= 0 {
		return
	}
	compactorBlocksCreatedTotal.Inc()
	compactorGenerationsCompactedTotal.Add(float64(count))
}

func observeTruncated(count int64) {
	if count <= 0 {
		return
	}
	compactorTruncatedTotal.Add(float64(count))
}

func setLeaseMetric(tenantID string, shardID int, held bool) {
	value := 0.0
	if held {
		value = 1
	}
	compactorLeaseHeld.WithLabelValues(tenantID, formatShardID(shardID)).Set(value)
}

func observeClaimBatch(status string) {
	compactorClaimBatchTotal.WithLabelValues(status).Inc()
}

func observeClaimSweep(recovered int64) {
	if recovered > 0 {
		compactorClaimStaleRecoveredTotal.Add(float64(recovered))
	}
}

func addWorkerActive(delta float64) {
	compactorWorkerActive.Add(delta)
}

func setShardBacklogMetric(tenantID string, shardID int, backlog int) {
	compactorShardBacklog.WithLabelValues(tenantID, formatShardID(shardID)).Set(float64(backlog))
}

func observeDrainDuration(tenantID string, shardID int, duration time.Duration) {
	compactorDrainDuration.WithLabelValues(tenantID, formatShardID(shardID)).Observe(duration.Seconds())
}

func observeSweepDuration(duration time.Duration) {
	compactorSweepDuration.Observe(duration.Seconds())
}

func formatShardID(shardID int) string {
	return strconv.Itoa(shardID)
}
