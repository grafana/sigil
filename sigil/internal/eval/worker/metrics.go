package worker

import (
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	evalExecutionsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_executions_total",
		Help: "Total number of evaluator executions partitioned by tenant, evaluator, kind, rule, status, model, and agent.",
	}, []string{"tenant_id", "evaluator", "evaluator_kind", "rule", "status", "gen_ai_request_model", "gen_ai_agent_name"})
	evalDurationSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_eval_duration_seconds",
		Help:    "Evaluation execution duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"tenant_id", "evaluator", "evaluator_kind", "rule"})
	evalScoresTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_scores_total",
		Help: "Scores emitted by evaluation workers partitioned by tenant, evaluator, kind, rule, key, pass/fail, model, and agent.",
	}, []string{"tenant_id", "evaluator", "evaluator_kind", "rule", "score_key", "passed", "gen_ai_request_model", "gen_ai_agent_name"})
	evalQueueDepth = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sigil_eval_queue_depth",
		Help: "Current evaluation queue depth partitioned by tenant and work-item status.",
	}, []string{"tenant_id", "status"})
	evalEnqueueTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_enqueue_total",
		Help: "Work items enqueued for online evaluation.",
	}, []string{"tenant_id", "evaluator_kind", "rule"})
	evalEnqueueErrorsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_enqueue_errors_total",
		Help: "Errors while enqueueing evaluation work items.",
	}, []string{"tenant_id"})
	evalRetriesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_retries_total",
		Help: "Retry attempts for evaluation work items.",
	}, []string{"tenant_id", "evaluator", "evaluator_kind", "rule"})

	evalJudgeRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_judge_requests_total",
		Help: "Judge requests by tenant, provider, model, and status.",
	}, []string{"tenant_id", "provider", "model", "status"})
	evalJudgeDurationSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_eval_judge_duration_seconds",
		Help:    "Judge request duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"tenant_id", "provider", "model"})
	evalJudgeTokensTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_judge_tokens_total",
		Help: "Judge token usage by tenant, provider, model, and direction.",
	}, []string{"tenant_id", "provider", "model", "direction"})
	evalJudgeErrorsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_judge_errors_total",
		Help: "Judge errors by tenant, provider, model, and error type.",
	}, []string{"tenant_id", "provider", "model", "error_type"})

	evalScoreIngestTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_score_ingest_total",
		Help: "Score ingest events partitioned by tenant and source.",
	}, []string{"tenant_id", "source"})
	evalScoreIngestErrorsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_score_ingest_errors_total",
		Help: "Score ingest validation or persistence errors by tenant and error type.",
	}, []string{"tenant_id", "error_type"})

	evalActiveRules = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sigil_eval_active_rules",
		Help: "Current number of active rules per tenant.",
	}, []string{"tenant_id"})
	evalActiveEvaluators = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sigil_eval_active_evaluators",
		Help: "Current number of active evaluators per tenant.",
	}, []string{"tenant_id"})
)

func observeExecution(tenantID, evaluatorID, evaluatorKind, ruleID, status, model, agentName string) {
	evalExecutionsTotal.WithLabelValues(tenantID, evaluatorID, evaluatorKind, ruleID, status, model, agentName).Inc()
}

func observeExecutionDuration(tenantID, evaluatorID, evaluatorKind, ruleID string, duration time.Duration) {
	evalDurationSeconds.WithLabelValues(tenantID, evaluatorID, evaluatorKind, ruleID).Observe(duration.Seconds())
}

func observeProducedScore(tenantID, evaluatorID, evaluatorKind, ruleID, scoreKey string, passed *bool, model, agentName string) {
	passedValue := "unknown"
	if passed != nil {
		passedValue = strconv.FormatBool(*passed)
	}
	evalScoresTotal.WithLabelValues(tenantID, evaluatorID, evaluatorKind, ruleID, scoreKey, passedValue, model, agentName).Inc()
}

func setQueueDepth(tenantID, status string, count int64) {
	evalQueueDepth.WithLabelValues(tenantID, status).Set(float64(count))
}

func observeRetry(tenantID, evaluatorID, evaluatorKind, ruleID string) {
	evalRetriesTotal.WithLabelValues(tenantID, evaluatorID, evaluatorKind, ruleID).Inc()
}

func ObserveEnqueue(tenantID, evaluatorKind, ruleID string) {
	evalEnqueueTotal.WithLabelValues(tenantID, evaluatorKind, ruleID).Inc()
}

func ObserveEnqueueError(tenantID string) {
	evalEnqueueErrorsTotal.WithLabelValues(tenantID).Inc()
}

func ObserveJudgeRequest(tenantID, provider, model, status string) {
	evalJudgeRequestsTotal.WithLabelValues(tenantID, provider, model, status).Inc()
}

func ObserveJudgeDuration(tenantID, provider, model string, duration time.Duration) {
	evalJudgeDurationSeconds.WithLabelValues(tenantID, provider, model).Observe(duration.Seconds())
}

func ObserveJudgeTokens(tenantID, provider, model, direction string, count int64) {
	if count <= 0 {
		return
	}
	evalJudgeTokensTotal.WithLabelValues(tenantID, provider, model, direction).Add(float64(count))
}

func ObserveJudgeError(tenantID, provider, model, errorType string) {
	evalJudgeErrorsTotal.WithLabelValues(tenantID, provider, model, errorType).Inc()
}

func ObserveScoreIngest(tenantID, source string) {
	evalScoreIngestTotal.WithLabelValues(tenantID, source).Inc()
}

func ObserveScoreIngestError(tenantID, errorType string) {
	evalScoreIngestErrorsTotal.WithLabelValues(tenantID, errorType).Inc()
}

func SetActiveRules(tenantID string, count int64) {
	evalActiveRules.WithLabelValues(tenantID).Set(float64(count))
}

func SetActiveEvaluators(tenantID string, count int64) {
	evalActiveEvaluators.WithLabelValues(tenantID).Set(float64(count))
}

type judgeMetricsObserver struct{}

func (judgeMetricsObserver) ObserveJudgeRequest(tenantID, provider, model, status string) {
	ObserveJudgeRequest(tenantID, provider, model, status)
}

func (judgeMetricsObserver) ObserveJudgeDuration(tenantID, provider, model string, duration time.Duration) {
	ObserveJudgeDuration(tenantID, provider, model, duration)
}

func (judgeMetricsObserver) ObserveJudgeTokens(tenantID, provider, model, direction string, count int64) {
	ObserveJudgeTokens(tenantID, provider, model, direction, count)
}

func (judgeMetricsObserver) ObserveJudgeError(tenantID, provider, model, errorType string) {
	ObserveJudgeError(tenantID, provider, model, errorType)
}
