package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/grafana/sigil/api/internal/config"
	sigilv1 "github.com/grafana/sigil/api/internal/gen/sigil/v1"
	"github.com/grafana/sigil/api/internal/generations"
	"github.com/grafana/sigil/api/internal/ingest"
	"github.com/grafana/sigil/api/internal/query"
	"github.com/grafana/sigil/api/internal/server"
	"github.com/grafana/sigil/api/internal/storage/mysql"
	"github.com/grafana/sigil/api/internal/storage/object"
	"github.com/grafana/sigil/api/internal/tempo"
	"github.com/grafana/sigil/api/internal/tenantauth"
	collecttracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
)

func main() {
	cfg := config.FromEnv()

	generationStore := generations.NewMemoryStore()
	_ = mysql.NewStore(cfg.MySQLDSN)
	_ = object.NewStore(cfg.ObjectStoreEndpoint, cfg.ObjectStoreBucket)

	generationsSvc := generations.NewService(generationStore)
	generationsGRPC := generations.NewGRPCServer(generationsSvc)
	querySvc := query.NewService()
	tempoClient := tempo.NewClient(cfg.TempoOTLPEndpoint)
	ingestSvc := ingest.NewService(tempoClient)
	ingestGRPC := ingest.NewGRPCServer(ingestSvc)
	tenantAuthCfg := tenantauth.Config{
		Enabled:      cfg.AuthEnabled,
		FakeTenantID: cfg.FakeTenantID,
	}
	protectedHTTP := tenantauth.HTTPMiddleware(tenantAuthCfg)

	apiMux := http.NewServeMux()
	server.RegisterRoutes(apiMux, querySvc, generationsSvc, protectedHTTP)
	apiServer := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: apiMux,
	}

	otlpHTTPMux := http.NewServeMux()
	ingest.RegisterHTTPRoutes(otlpHTTPMux, ingestSvc, protectedHTTP)
	otlpHTTPServer := &http.Server{
		Addr:    cfg.OTLPHTTPAddr,
		Handler: otlpHTTPMux,
	}

	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(tenantauth.UnaryServerInterceptor(tenantAuthCfg)),
		grpc.StreamInterceptor(tenantauth.StreamServerInterceptor(tenantAuthCfg)),
	)
	collecttracev1.RegisterTraceServiceServer(grpcServer, ingestGRPC)
	sigilv1.RegisterGenerationIngestServiceServer(grpcServer, generationsGRPC)
	grpcListener, err := net.Listen("tcp", cfg.OTLPGRPCAddr)
	if err != nil {
		log.Fatalf("listen grpc %s: %v", cfg.OTLPGRPCAddr, err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	group, groupCtx := errgroup.WithContext(ctx)

	group.Go(func() error {
		log.Printf("sigil api listening on %s", cfg.HTTPAddr)
		err := apiServer.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	})

	group.Go(func() error {
		log.Printf("sigil otlp/http listening on %s", cfg.OTLPHTTPAddr)
		err := otlpHTTPServer.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	})

	group.Go(func() error {
		log.Printf("sigil otlp/grpc listening on %s", cfg.OTLPGRPCAddr)
		err := grpcServer.Serve(grpcListener)
		if err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			return err
		}
		return nil
	})

	group.Go(func() error {
		<-groupCtx.Done()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_ = apiServer.Shutdown(shutdownCtx)
		_ = otlpHTTPServer.Shutdown(shutdownCtx)
		grpcServer.GracefulStop()
		return nil
	})

	if err := group.Wait(); err != nil {
		log.Fatalf("sigil api stopped with error: %v", err)
	}
}
