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
	"github.com/grafana/sigil/sigil/internal/feedback"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/internal/queryproxy"
	"github.com/grafana/sigil/sigil/internal/server"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
	"github.com/grafana/sigil/sigil/internal/storage/object"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"google.golang.org/grpc"
)

type serverModule struct {
	cfg    config.Config
	logger log.Logger

	modelCardSvc     *modelcards.Service
	runModelCardSync bool

	apiServer    *http.Server
	grpcServer   *grpc.Server
	grpcListener net.Listener

	runErr chan error
}

func newServerModule(cfg config.Config, logger log.Logger, modelCardSvc *modelcards.Service, runModelCardSync bool) services.Service {
	module := &serverModule{
		cfg:              cfg,
		logger:           logger,
		modelCardSvc:     modelCardSvc,
		runModelCardSync: runModelCardSync,
		runErr:           make(chan error, 2),
	}
	return services.NewBasicService(module.start, module.run, module.stop).WithName(config.TargetServer)
}

func (m *serverModule) start(ctx context.Context) error {
	generationStore, err := m.buildGenerationStore(ctx)
	if err != nil {
		return err
	}

	generationSvc := generationingest.NewService(generationStore)
	generationGRPC := generationingest.NewGRPCServer(generationSvc)
	var feedbackStore feedback.Store
	var feedbackSvc *feedback.Service
	if m.cfg.ConversationRatingsEnabled || m.cfg.ConversationAnnotationsEnabled {
		feedbackStore, err = m.buildFeedbackStore(generationStore)
		if err != nil {
			return err
		}
		feedbackSvc = feedback.NewService(feedbackStore)
	}
	var conversationStore storage.ConversationStore
	if store, ok := generationStore.(storage.ConversationStore); ok {
		conversationStore = store
	}
	var walReader storage.WALReader
	if reader, ok := generationStore.(storage.WALReader); ok {
		walReader = reader
	}
	var blockMetadataStore storage.BlockMetadataStore
	if metadataStore, ok := generationStore.(storage.BlockMetadataStore); ok {
		blockMetadataStore = metadataStore
	}
	blockReader, err := m.buildBlockReader(ctx)
	if err != nil {
		return err
	}
	querySvc, err := query.NewServiceWithDependencies(query.ServiceDependencies{
		ConversationStore:  conversationStore,
		WALReader:          walReader,
		BlockMetadataStore: blockMetadataStore,
		BlockReader:        blockReader,
		FeedbackStore:      feedbackStore,
		TempoBaseURL:       m.cfg.QueryProxy.TempoBaseURL,
		HTTPClient:         &http.Client{Timeout: m.cfg.QueryProxy.Timeout},
	})
	if err != nil {
		return err
	}
	if m.modelCardSvc == nil {
		return errors.New("model-card service is required")
	}
	tenantAuthCfg := tenantauth.Config{
		Enabled:      m.cfg.AuthEnabled,
		FakeTenantID: m.cfg.FakeTenantID,
	}
	protectedHTTP := tenantauth.HTTPMiddleware(tenantAuthCfg)
	queryProxy, err := queryproxy.New(queryproxy.Config{
		PrometheusBaseURL: m.cfg.QueryProxy.PrometheusBaseURL,
		TempoBaseURL:      m.cfg.QueryProxy.TempoBaseURL,
		Timeout:           m.cfg.QueryProxy.Timeout,
	})
	if err != nil {
		return fmt.Errorf("create query proxy: %w", err)
	}

	apiMux := http.NewServeMux()
	server.RegisterRoutesWithQueryProxy(
		apiMux,
		querySvc,
		generationSvc,
		feedbackSvc,
		m.cfg.ConversationRatingsEnabled,
		m.cfg.ConversationAnnotationsEnabled,
		m.modelCardSvc,
		protectedHTTP,
		queryProxy,
	)
	m.apiServer = &http.Server{
		Addr:    m.cfg.HTTPAddr,
		Handler: apiMux,
	}

	m.grpcServer = grpc.NewServer(
		grpc.UnaryInterceptor(tenantauth.UnaryServerInterceptor(tenantAuthCfg)),
		grpc.StreamInterceptor(tenantauth.StreamServerInterceptor(tenantAuthCfg)),
	)
	sigilv1.RegisterGenerationIngestServiceServer(m.grpcServer, generationGRPC)

	m.grpcListener, err = net.Listen("tcp", m.cfg.OTLPGRPCAddr)
	if err != nil {
		return fmt.Errorf("listen grpc %s: %w", m.cfg.OTLPGRPCAddr, err)
	}

	go m.serveHTTP()
	go m.serveGRPC()

	return nil
}

func (m *serverModule) run(ctx context.Context) error {
	if m.runModelCardSync && m.modelCardSvc != nil {
		go func() {
			if err := m.modelCardSvc.RunSyncLoop(ctx); err != nil {
				m.pushRunError(err)
			}
		}()
	}

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
	if m.grpcServer != nil {
		m.grpcServer.GracefulStop()
	}
	if m.grpcListener != nil {
		_ = m.grpcListener.Close()
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

func (m *serverModule) serveGRPC() {
	_ = level.Info(m.logger).Log("msg", "sigil generation/grpc listening", "addr", m.cfg.OTLPGRPCAddr)
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
	default:
		return nil, fmt.Errorf("unsupported storage backend %q", m.cfg.StorageBackend)
	}
}

func (m *serverModule) buildFeedbackStore(generationStore generationingest.Store) (feedback.Store, error) {
	if store, ok := generationStore.(feedback.Store); ok {
		return store, nil
	}
	return nil, fmt.Errorf("storage backend %q does not support feedback storage", m.cfg.StorageBackend)
}

func (m *serverModule) buildBlockReader(ctx context.Context) (storage.BlockReader, error) {
	blockStore, err := object.NewStoreWithProviderConfig(ctx, object.ProviderConfig{
		Backend: m.cfg.ObjectStore.Backend,
		Bucket:  m.cfg.ObjectStore.Bucket,
		S3: object.S3ProviderConfig{
			Endpoint:      m.cfg.ObjectStore.S3.Endpoint,
			Region:        m.cfg.ObjectStore.S3.Region,
			AccessKey:     m.cfg.ObjectStore.S3.AccessKey,
			SecretKey:     m.cfg.ObjectStore.S3.SecretKey,
			Insecure:      m.cfg.ObjectStore.S3.Insecure,
			UseAWSSDKAuth: m.cfg.ObjectStore.S3.UseAWSSDKAuth,
		},
		GCS: object.GCSProviderConfig{
			Bucket:         m.cfg.ObjectStore.GCS.Bucket,
			ServiceAccount: m.cfg.ObjectStore.GCS.ServiceAccount,
			UseGRPC:        m.cfg.ObjectStore.GCS.UseGRPC,
		},
		Azure: object.AzureProviderConfig{
			ContainerName:           m.cfg.ObjectStore.Azure.ContainerName,
			StorageAccountName:      m.cfg.ObjectStore.Azure.StorageAccountName,
			StorageAccountKey:       m.cfg.ObjectStore.Azure.StorageAccountKey,
			StorageConnectionString: m.cfg.ObjectStore.Azure.StorageConnectionString,
			Endpoint:                m.cfg.ObjectStore.Azure.Endpoint,
			CreateContainer:         m.cfg.ObjectStore.Azure.CreateContainer,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create object store reader: %w", err)
	}
	return blockStore, nil
}
