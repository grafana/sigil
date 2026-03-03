package tenantauth

import (
	"net/http"

	"github.com/grafana/dskit/middleware"
	"github.com/grafana/dskit/tenant"
	"github.com/grafana/dskit/user"
)

func HTTPMiddleware(cfg Config) func(http.Handler) http.Handler {
	cfg = normalizeConfig(cfg)
	if cfg.Enabled {
		return func(next http.Handler) http.Handler {
			protected := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if _, err := tenant.TenantID(req.Context()); err != nil {
					observeAuthFailure("http", "tenant_id")
					http.Error(w, err.Error(), http.StatusUnauthorized)
					return
				}
				next.ServeHTTP(w, req)
			})
			return middleware.AuthenticateUser.Wrap(protected)
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if err := tenant.ValidTenantID(cfg.FakeTenantID); err != nil {
				observeAuthFailure("http", "invalid_fake_tenant")
				http.Error(w, "invalid fake tenant id", http.StatusInternalServerError)
				return
			}
			ctx := user.InjectOrgID(req.Context(), cfg.FakeTenantID)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	}
}
