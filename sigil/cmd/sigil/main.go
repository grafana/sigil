package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	gokitlog "github.com/go-kit/log"
	"github.com/go-kit/log/level"
	sigil "github.com/grafana/sigil/sigil/internal"
	"github.com/grafana/sigil/sigil/internal/config"
)

func main() {
	cfg := config.FromEnv()

	var targetFlag string
	flag.StringVar(&targetFlag, "target", cfg.Target, "runtime target: all|server|querier|compactor")
	flag.Parse()

	cfg.SetTarget(targetFlag)
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid config: %v", err)
	}

	logger := gokitlog.NewLogfmtLogger(gokitlog.NewSyncWriter(os.Stdout))

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
