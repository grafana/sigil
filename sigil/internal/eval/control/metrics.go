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

const (
	controlUnknownLabel  = "unknown"
	controlUnknownMethod = "UNKNOWN"
	controlOtherMethod   = "OTHER"
)

type statusCapturingResponseWriter struct {
	http.ResponseWriter
	statusCode int
	metricsCtx context.Context
}

func (w *statusCapturingResponseWriter) Unwrap() http.ResponseWriter {
	if w == nil {
		return nil
	}
	return w.ResponseWriter
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
		writer := &statusCapturingResponseWriter{ResponseWriter: w, metricsCtx: req.Context()}
		next.ServeHTTP(writer, req)

		statusCode := writer.statusCode
		if statusCode == 0 {
			statusCode = http.StatusOK
		}
		observeControlRequestMetrics(writer.metricsCtx, endpointLabel, req.Method, statusCode, time.Since(startedAt))
	})
}

// captureMetricsContext propagates the (potentially enriched) request context
// back to the statusCapturingResponseWriter so the outer metrics layer can
// see values injected by inner middleware (e.g., tenant ID from auth).
func captureMetricsContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cw, ok := w.(*statusCapturingResponseWriter); ok {
			cw.metricsCtx = r.Context()
		}
		next.ServeHTTP(w, r)
	})
}

func observeControlRequestMetrics(ctx context.Context, endpoint, method string, statusCode int, duration time.Duration) {
	tenantLabel := controlTenantID(ctx)
	methodLabel := controlMethod(method)
	statusLabel := controlStatusClass(statusCode)
	evalControlRequestsTotal.WithLabelValues(tenantLabel, endpoint, methodLabel, statusLabel).Inc()
	evalControlRequestDuration.WithLabelValues(tenantLabel, endpoint, methodLabel, statusLabel).Observe(duration.Seconds())
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
		return controlUnknownLabel
	}
	return trimmed
}

func controlMethod(method string) string {
	trimmed := strings.ToUpper(strings.TrimSpace(method))
	switch trimmed {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut,
		http.MethodPatch, http.MethodDelete, http.MethodOptions:
		return trimmed
	case "":
		return controlUnknownMethod
	default:
		return controlOtherMethod
	}
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
