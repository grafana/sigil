package sigil

import (
	"net/http"
	"sync"

	"github.com/grafana/sigil/sigil/internal/server"
	"google.golang.org/grpc"
)

// HTTPRouteRegistrar registers HTTP routes onto a mux with the provided
// protected middleware wrapper.
type HTTPRouteRegistrar func(mux *http.ServeMux, protectedMiddleware func(http.Handler) http.Handler)

// GRPCServiceRegistrar registers gRPC services onto the provided server.
type GRPCServiceRegistrar func(server *grpc.Server)

// serverTransportRegistry stores route and service registration hooks that
// runtime modules contribute before the transport module starts listeners.
type serverTransportRegistry struct {
	mu sync.Mutex

	httpRegistrars []HTTPRouteRegistrar
	grpcRegistrars []GRPCServiceRegistrar
	readiness      []server.ReadinessCheck
}

func newServerTransportRegistry() *serverTransportRegistry {
	return &serverTransportRegistry{
		httpRegistrars: make([]HTTPRouteRegistrar, 0, 4),
		grpcRegistrars: make([]GRPCServiceRegistrar, 0, 2),
		readiness:      make([]server.ReadinessCheck, 0, 2),
	}
}

func (r *serverTransportRegistry) RegisterHTTP(registrar HTTPRouteRegistrar) {
	if registrar == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.httpRegistrars = append(r.httpRegistrars, registrar)
}

func (r *serverTransportRegistry) RegisterGRPC(registrar GRPCServiceRegistrar) {
	if registrar == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.grpcRegistrars = append(r.grpcRegistrars, registrar)
}

func (r *serverTransportRegistry) RegisterReadiness(check server.ReadinessCheck) {
	if check == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.readiness = append(r.readiness, check)
}

func (r *serverTransportRegistry) ApplyHTTP(mux *http.ServeMux, protectedMiddleware func(http.Handler) http.Handler) {
	if mux == nil {
		return
	}

	r.mu.Lock()
	registrars := append([]HTTPRouteRegistrar(nil), r.httpRegistrars...)
	r.mu.Unlock()

	for _, registrar := range registrars {
		registrar(mux, protectedMiddleware)
	}
}

func (r *serverTransportRegistry) ApplyGRPC(server *grpc.Server) {
	if server == nil {
		return
	}

	r.mu.Lock()
	registrars := append([]GRPCServiceRegistrar(nil), r.grpcRegistrars...)
	r.mu.Unlock()

	for _, registrar := range registrars {
		registrar(server)
	}
}

func (r *serverTransportRegistry) ReadinessChecks() []server.ReadinessCheck {
	if r == nil {
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]server.ReadinessCheck(nil), r.readiness...)
}

func (r *serverTransportRegistry) HasGRPCRegistrars() bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.grpcRegistrars) > 0
}
