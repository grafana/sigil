package control

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/grafana/dskit/tenant"
	"github.com/grafana/sigil/sigil/internal/metriclabels"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	evalControlRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_eval_control_requests_total",
		Help: "Evaluation control-plane HTTP requests by tenant, endpoint, method, and status class.",
	}, []string{"tenant_id", "endpoint", "method", "status_class"})
	evalControlRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_eval_control_request_duration_seconds",
		Help:    "Evaluation control-plane HTTP request duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"tenant_id", "endpoint", "method", "status_class"})
)

type statusCapturingResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *statusCapturingResponseWriter) WriteHeader(statusCode int) {
	w.statusCode = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *statusCapturingResponseWriter) Write(data []byte) (int, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	return w.ResponseWriter.Write(data)
}

func instrumentControlHandler(endpoint string, next http.Handler) http.Handler {
	endpointLabel := controlEndpoint(endpoint)
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		startedAt := time.Now()
		writer := &statusCapturingResponseWriter{ResponseWriter: w}
		next.ServeHTTP(writer, req)

		statusCode := writer.statusCode
		if statusCode == 0 {
			statusCode = http.StatusOK
		}
		observeControlRequestMetrics(req.Context(), endpointLabel, req.Method, statusCode, time.Since(startedAt))
	})
}

func observeControlRequestMetrics(ctx context.Context, endpoint, method string, statusCode int, duration time.Duration) {
	evalControlRequestsTotal.WithLabelValues(controlTenantID(ctx), controlEndpoint(endpoint), controlMethod(method), controlStatusClass(statusCode)).Inc()
	evalControlRequestDuration.WithLabelValues(controlTenantID(ctx), controlEndpoint(endpoint), controlMethod(method), controlStatusClass(statusCode)).Observe(duration.Seconds())
}

func controlTenantID(ctx context.Context) string {
	tenantID, err := tenant.TenantID(ctx)
	if err != nil {
		return metriclabels.TenantID("")
	}
	return metriclabels.TenantID(tenantID)
}

func controlEndpoint(endpoint string) string {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}

func controlMethod(method string) string {
	trimmed := strings.ToUpper(strings.TrimSpace(method))
	if trimmed == "" {
		return "UNKNOWN"
	}
	return trimmed
}

func controlStatusClass(statusCode int) string {
	switch {
	case statusCode >= 500:
		return "5xx"
	case statusCode >= 400:
		return "4xx"
	case statusCode >= 300:
		return "3xx"
	case statusCode >= 200:
		return "2xx"
	default:
		return "1xx"
	}
}
