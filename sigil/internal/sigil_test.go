package sigil

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/go-kit/log"
	"github.com/grafana/sigil/sigil/internal/config"
)

func TestRuntimeServerTargetServesHealth(t *testing.T) {
	cfg := testRuntimeConfig(t, config.TargetServer)
	cancel, done := runRuntime(t, cfg)
	defer cancel()

	waitForHealth(t, cfg.HTTPAddr)

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("runtime returned error: %v", err)
	}
}

func TestRuntimeAllTargetServesHealth(t *testing.T) {
	cfg := testRuntimeConfig(t, config.TargetAll)
	cancel, done := runRuntime(t, cfg)
	defer cancel()

	waitForHealth(t, cfg.HTTPAddr)

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("runtime returned error: %v", err)
	}
}

func TestRuntimePlaceholderTargetsRemainHealthyUntilCanceled(t *testing.T) {
	targets := []string{config.TargetQuerier, config.TargetCompactor}

	for _, target := range targets {
		t.Run(target, func(t *testing.T) {
			cfg := testRuntimeConfig(t, target)
			cancel, done := runRuntime(t, cfg)

			time.Sleep(200 * time.Millisecond)

			cancel()
			if err := <-done; err != nil {
				t.Fatalf("runtime returned error: %v", err)
			}
		})
	}
}

func runRuntime(t *testing.T, cfg config.Config) (func(), <-chan error) {
	t.Helper()

	runtime, err := NewRuntime(cfg, log.NewNopLogger())
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- runtime.Run(ctx)
	}()

	return cancel, done
}

func waitForHealth(t *testing.T, addr string) {
	t.Helper()

	client := &http.Client{Timeout: 500 * time.Millisecond}
	url := fmt.Sprintf("http://%s/healthz", addr)
	deadline := time.Now().Add(10 * time.Second)

	for {
		if time.Now().After(deadline) {
			t.Fatalf("health endpoint did not become ready: %s", url)
		}

		response, err := client.Get(url)
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return
			}
		}

		time.Sleep(100 * time.Millisecond)
	}
}

func testRuntimeConfig(t *testing.T, target string) config.Config {
	t.Helper()

	cfg := config.FromEnv()
	cfg.HTTPAddr = randomLocalAddr(t)
	cfg.OTLPHTTPAddr = randomLocalAddr(t)
	cfg.OTLPGRPCAddr = randomLocalAddr(t)
	cfg.AuthEnabled = false
	cfg.StorageBackend = "memory"
	cfg.Target = target

	if err := cfg.Validate(); err != nil {
		t.Fatalf("config validation failed: %v", err)
	}
	return cfg
}

func randomLocalAddr(t *testing.T) string {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve local port: %v", err)
	}
	defer func() {
		_ = listener.Close()
	}()

	return listener.Addr().String()
}
