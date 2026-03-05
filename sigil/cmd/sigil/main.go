package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	gokitlog "github.com/go-kit/log"
	"github.com/go-kit/log/level"
	sigil "github.com/grafana/sigil/sigil/internal"
	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/telemetry"
)

func main() {
	cfg := config.FromEnv()

	var targetFlag string
	flag.StringVar(&targetFlag, "target", cfg.Target, "runtime target: all|server|ingester|querier|compactor|catalog-sync|eval-worker")
	flag.Parse()

	cfg.SetTarget(targetFlag)
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid config: %v", err)
	}

	logger := gokitlog.NewLogfmtLogger(gokitlog.NewSyncWriter(os.Stdout))
	tracingShutdown, tracingState := telemetry.InitTracing(context.Background(), logger)
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := tracingShutdown(shutdownCtx); err != nil {
			_ = level.Warn(logger).Log("msg", "failed to shutdown tracing exporter", "err", err)
		}
	}()
	_ = level.Info(logger).Log("msg", "tracing bootstrap complete", "enabled", tracingState.Enabled, "reason", tracingState.Reason)

	runtime, err := sigil.NewRuntime(cfg, logger)
	if err != nil {
		log.Fatalf("create runtime: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	_ = level.Info(logger).Log("msg", "starting sigil", "target", cfg.Target)
	if err := runtime.Run(ctx); err != nil {
		log.Fatalf("sigil stopped with error: %v", err)
	}
	_ = level.Info(logger).Log("msg", "sigil stopped", "target", cfg.Target)
}
