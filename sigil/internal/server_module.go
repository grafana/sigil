package sigil

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	traceingest "github.com/grafana/sigil/sigil/internal/ingest/trace"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/internal/server"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
	"github.com/grafana/sigil/sigil/internal/storage/object"
	"github.com/grafana/sigil/sigil/internal/tempo"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	collecttracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc"
)

type serverModule struct {
	cfg    config.Config
	logger log.Logger

	apiServer      *http.Server
	otlpHTTPServer *http.Server
	grpcServer     *grpc.Server
	grpcListener   net.Listener
	tempoClient    *tempo.Client

	runErr chan error
}

func newServerModule(cfg config.Config, logger log.Logger) services.Service {
	module := &serverModule{
		cfg:    cfg,
		logger: logger,
		runErr: make(chan error, 3),
	}
	return services.NewBasicService(module.start, module.run, module.stop).WithName(config.TargetServer)
}

func (m *serverModule) start(ctx context.Context) error {
	generationStore, err := m.buildGenerationStore(ctx)
	if err != nil {
		return err
	}
	_ = object.NewStore(m.cfg.ObjectStoreEndpoint, m.cfg.ObjectStoreBucket)

	generationSvc := generationingest.NewService(generationStore)
	generationGRPC := generationingest.NewGRPCServer(generationSvc)
	querySvc := query.NewService()
	m.tempoClient = tempo.NewClient(m.cfg.TempoOTLPGRPCEndpoint, m.cfg.TempoOTLPHTTPEndpoint)
	traceSvc := traceingest.NewService(m.tempoClient)
	traceGRPC := traceingest.NewGRPCServer(traceSvc)
	tenantAuthCfg := tenantauth.Config{
		Enabled:      m.cfg.AuthEnabled,
		FakeTenantID: m.cfg.FakeTenantID,
	}
	protectedHTTP := tenantauth.HTTPMiddleware(tenantAuthCfg)

	apiMux := http.NewServeMux()
	server.RegisterRoutes(apiMux, querySvc, generationSvc, protectedHTTP)
	m.apiServer = &http.Server{
		Addr:    m.cfg.HTTPAddr,
		Handler: apiMux,
	}

	otlpHTTPMux := http.NewServeMux()
	traceingest.RegisterHTTPRoutes(otlpHTTPMux, traceSvc, protectedHTTP)
	m.otlpHTTPServer = &http.Server{
		Addr:    m.cfg.OTLPHTTPAddr,
		Handler: otlpHTTPMux,
	}

	m.grpcServer = grpc.NewServer(
		grpc.UnaryInterceptor(tenantauth.UnaryServerInterceptor(tenantAuthCfg)),
		grpc.StreamInterceptor(tenantauth.StreamServerInterceptor(tenantAuthCfg)),
	)
	collecttracev1.RegisterTraceServiceServer(m.grpcServer, traceGRPC)
	sigilv1.RegisterGenerationIngestServiceServer(m.grpcServer, generationGRPC)

	m.grpcListener, err = net.Listen("tcp", m.cfg.OTLPGRPCAddr)
	if err != nil {
		return fmt.Errorf("listen grpc %s: %w", m.cfg.OTLPGRPCAddr, err)
	}

	go m.serveHTTP()
	go m.serveOTLPHTTP()
	go m.serveGRPC()

	return nil
}

func (m *serverModule) run(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return nil
	case err := <-m.runErr:
		return err
	}
}

func (m *serverModule) stop(_ error) error {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if m.apiServer != nil {
		_ = m.apiServer.Shutdown(shutdownCtx)
	}
	if m.otlpHTTPServer != nil {
		_ = m.otlpHTTPServer.Shutdown(shutdownCtx)
	}
	if m.grpcServer != nil {
		m.grpcServer.GracefulStop()
	}
	if m.grpcListener != nil {
		_ = m.grpcListener.Close()
	}
	if m.tempoClient != nil {
		_ = m.tempoClient.Close()
	}

	return nil
}

func (m *serverModule) serveHTTP() {
	_ = level.Info(m.logger).Log("msg", "sigil http listening", "addr", m.cfg.HTTPAddr)
	err := m.apiServer.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		m.pushRunError(err)
	}
}

func (m *serverModule) serveOTLPHTTP() {
	_ = level.Info(m.logger).Log("msg", "sigil otlp/http listening", "addr", m.cfg.OTLPHTTPAddr)
	err := m.otlpHTTPServer.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		m.pushRunError(err)
	}
}

func (m *serverModule) serveGRPC() {
	_ = level.Info(m.logger).Log("msg", "sigil otlp/grpc listening", "addr", m.cfg.OTLPGRPCAddr)
	err := m.grpcServer.Serve(m.grpcListener)
	if err != nil && !errors.Is(err, grpc.ErrServerStopped) {
		m.pushRunError(err)
	}
}

func (m *serverModule) pushRunError(err error) {
	select {
	case m.runErr <- err:
	default:
	}
}

func (m *serverModule) buildGenerationStore(ctx context.Context) (generationingest.Store, error) {
	switch strings.ToLower(strings.TrimSpace(m.cfg.StorageBackend)) {
	case "", "mysql":
		store, err := mysql.NewWALStore(m.cfg.MySQLDSN)
		if err != nil {
			return nil, fmt.Errorf("create mysql wal store: %w", err)
		}
		if m.cfg.Target == config.TargetServer || m.cfg.Target == config.TargetAll {
			if err := store.AutoMigrate(ctx); err != nil {
				return nil, err
			}
		}
		return store, nil
	case "memory":
		return generationingest.NewMemoryStore(), nil
	default:
		return nil, fmt.Errorf("unsupported storage backend %q", m.cfg.StorageBackend)
	}
}
