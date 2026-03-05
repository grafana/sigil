package sigil

import (
	"net/http"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	httpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_requests_total",
		Help: "Total HTTP requests partitioned by method, route, status class, and area.",
	}, []string{"method", "route", "status_class", "area"})
	httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name: "sigil_request_duration_seconds",
		Help: "HTTP request duration in seconds.",
		Buckets: []float64{
			0.005, 0.01, 0.025, 0.05, 0.1,
			0.25, 0.5, 1, 2.5, 5,
			10, 15, 20, 30, 45, 60,
		},
	}, []string{"method", "route", "status_class", "area"})
	httpRequestMessageBytes = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_request_message_bytes",
		Help:    "HTTP request body size in bytes.",
		Buckets: []float64{128, 512, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304},
	}, []string{"method", "route", "area"})
	httpResponseMessageBytes = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_response_message_bytes",
		Help:    "HTTP response body size in bytes.",
		Buckets: []float64{128, 512, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304},
	}, []string{"method", "route", "status_class", "area"})
)

func observeHTTPRequestMetrics(req *http.Request, routePattern string, statusCode int, duration time.Duration, requestBytes int64, responseBytes int) {
	if req == nil {
		return
	}

	route := metricRouteLabel(routePattern)
	statusClass := metricStatusClass(statusCode)
	area := metricRequestArea(route, req.URL.Path)

	httpRequestsTotal.WithLabelValues(req.Method, route, statusClass, area).Inc()
	httpRequestDuration.WithLabelValues(req.Method, route, statusClass, area).Observe(duration.Seconds())
	if requestBytes > 0 {
		httpRequestMessageBytes.WithLabelValues(req.Method, route, area).Observe(float64(requestBytes))
	}
	if responseBytes > 0 {
		httpResponseMessageBytes.WithLabelValues(req.Method, route, statusClass, area).Observe(float64(responseBytes))
	}
}

func metricRouteLabel(routePattern string) string {
	route := strings.TrimSpace(routePattern)
	if route == "" {
		return "unmatched"
	}
	return route
}

func metricStatusClass(statusCode int) string {
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

func metricRequestArea(route string, requestPath string) string {
	if strings.HasPrefix(route, "/api/v1/conversations/") && (strings.HasSuffix(route, "/ratings") || strings.HasSuffix(route, "/annotations")) {
		return "feedback"
	}
	if route == "/api/v1/conversations/" && isFeedbackPath(requestPath) {
		return "feedback"
	}

	switch {
	case route == "/healthz":
		return "core"
	case route == "/metrics":
		return "observability"
	case route == "/api/v1/generations:export":
		return "ingest_generation"
	case route == "/api/v1/scores:export":
		return "ingest_scores"
	case strings.HasPrefix(route, "/api/v1/eval/"):
		return "eval_control"
	case strings.HasPrefix(route, "/api/v1/settings"):
		return "settings"
	case strings.HasPrefix(route, "/api/v1/model-cards"):
		return "model_cards"
	case strings.HasPrefix(route, "/api/v1/conversations"):
		return "query"
	case strings.HasPrefix(route, "/api/v1/generations/"):
		return "query"
	default:
		return "unknown"
	}
}

func isFeedbackPath(path string) bool {
	cleanPath := strings.TrimSpace(path)
	if !strings.HasPrefix(cleanPath, "/api/v1/conversations/") {
		return false
	}
	return strings.HasSuffix(cleanPath, "/ratings") || strings.HasSuffix(cleanPath, "/annotations")
}
