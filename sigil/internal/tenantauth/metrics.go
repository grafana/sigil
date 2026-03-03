package tenantauth

import (
	"strings"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var authFailuresTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "sigil_auth_failures_total",
	Help: "Authentication failures by transport and reason.",
}, []string{"transport", "reason"})

func observeAuthFailure(transport, reason string) {
	authFailuresTotal.WithLabelValues(normalizeTransport(transport), normalizeAuthReason(reason)).Inc()
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

func normalizeAuthReason(reason string) string {
	trimmed := strings.TrimSpace(reason)
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}
