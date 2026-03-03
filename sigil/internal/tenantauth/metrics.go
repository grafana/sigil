package tenantauth

import (
	"github.com/grafana/sigil/sigil/internal/metriclabels"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var authFailuresTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "sigil_auth_failures_total",
	Help: "Authentication failures by transport and reason.",
}, []string{"transport", "reason"})

func observeAuthFailure(transport, reason string) {
	authFailuresTotal.WithLabelValues(metriclabels.Transport(transport), metriclabels.Reason(reason)).Inc()
}
