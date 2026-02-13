package sigil

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-kit/log"
	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
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

func TestRuntimeAllTargetFailsWithoutCompactorDependencies(t *testing.T) {
	cfg := testRuntimeConfig(t, config.TargetAll)
	_, done := runRuntime(t, cfg)

	err := <-done
	if err == nil {
		t.Fatalf("expected runtime failure for target=all with memory backend")
	}
	if !strings.Contains(err.Error(), "compactor requires mysql storage backend") {
		t.Fatalf("unexpected runtime error: %v", err)
	}
}

func TestRuntimePlaceholderTargetsRemainHealthyUntilCanceled(t *testing.T) {
	targets := []string{config.TargetQuerier, config.TargetCatalogSync}

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

func TestRuntimeModelCardServiceIsSingleton(t *testing.T) {
	cfg := testRuntimeConfig(t, config.TargetAll)
	runtime, err := NewRuntime(cfg, log.NewNopLogger())
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}

	first, err := runtime.getModelCardService(context.Background(), true)
	if err != nil {
		t.Fatalf("build first model-card service: %v", err)
	}
	second, err := runtime.getModelCardService(context.Background(), true)
	if err != nil {
		t.Fatalf("build second model-card service: %v", err)
	}
	if first != second {
		t.Fatalf("expected shared model-card service instance")
	}
}

func TestRuntimeCompactorTargetFailsWithoutMySQLBackend(t *testing.T) {
	cfg := testRuntimeConfig(t, config.TargetCompactor)
	_, done := runRuntime(t, cfg)

	err := <-done
	if err == nil {
		t.Fatalf("expected runtime failure for target=compactor with memory backend")
	}
	if !strings.Contains(err.Error(), "compactor requires mysql storage backend") {
		t.Fatalf("unexpected runtime error: %v", err)
	}
}

func TestRuntimeCompactorTargetFailsWhenObjectStoreBootstrapFails(t *testing.T) {
	dsn, cleanup := newTestMySQLDSN(t)
	defer cleanup()

	cfg := testRuntimeConfig(t, config.TargetCompactor)
	cfg.StorageBackend = "mysql"
	cfg.MySQLDSN = dsn
	cfg.ObjectStore.Backend = "s3"
	cfg.ObjectStore.Bucket = "sigil"
	cfg.ObjectStore.S3.Endpoint = "http://127.0.0.1:1"
	cfg.ObjectStore.S3.AccessKey = "minioadmin"
	cfg.ObjectStore.S3.SecretKey = "minioadmin"
	cfg.ObjectStore.S3.Insecure = true

	runtime, err := NewRuntime(cfg, log.NewNopLogger())
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	err = runtime.Run(ctx)
	if err == nil {
		t.Fatalf("expected runtime failure when object store bootstrap is unreachable")
	}
	if !strings.Contains(err.Error(), "create object store for compactor") {
		t.Fatalf("unexpected runtime error: %v", err)
	}
}

func TestNewBlockStorePlaceholderBackendMapping(t *testing.T) {
	s3 := newBlockStorePlaceholder(config.ObjectStoreConfig{
		Backend: "s3",
		Bucket:  "sigil-s3",
		S3: config.ObjectStoreS3Config{
			Endpoint: "http://minio:9000",
		},
	})
	if s3.Endpoint() != "http://minio:9000" || s3.Bucket() != "sigil-s3" {
		t.Fatalf("unexpected s3 placeholder endpoint=%q bucket=%q", s3.Endpoint(), s3.Bucket())
	}

	gcs := newBlockStorePlaceholder(config.ObjectStoreConfig{
		Backend: "gcs",
		Bucket:  "fallback-bucket",
		GCS: config.ObjectStoreGCSConfig{
			Bucket: "sigil-gcs",
		},
	})
	if gcs.Endpoint() != "gcs://sigil-gcs" || gcs.Bucket() != "sigil-gcs" {
		t.Fatalf("unexpected gcs placeholder endpoint=%q bucket=%q", gcs.Endpoint(), gcs.Bucket())
	}

	azure := newBlockStorePlaceholder(config.ObjectStoreConfig{
		Backend: "azure",
		Bucket:  "fallback-container",
		Azure: config.ObjectStoreAzureConfig{
			ContainerName: "sigil-azure",
		},
	})
	if azure.Endpoint() != "azure://sigil-azure" || azure.Bucket() != "sigil-azure" {
		t.Fatalf("unexpected azure placeholder endpoint=%q bucket=%q", azure.Endpoint(), azure.Bucket())
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

func newTestMySQLDSN(t *testing.T) (string, func()) {
	t.Helper()

	ctx := context.Background()
	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "mysql:8.4",
			ExposedPorts: []string{"3306/tcp"},
			Env: map[string]string{
				"MYSQL_DATABASE":      "sigil",
				"MYSQL_USER":          "sigil",
				"MYSQL_PASSWORD":      "sigil",
				"MYSQL_ROOT_PASSWORD": "rootpass",
			},
			WaitingFor: wait.ForListeningPort("3306/tcp").WithStartupTimeout(2 * time.Minute),
		},
		Started: true,
	})
	if err != nil {
		t.Skipf("skip mysql runtime test (container start failed): %v", err)
	}

	cleanup := func() {
		_ = container.Terminate(context.Background())
	}

	host, err := container.Host(ctx)
	if err != nil {
		cleanup()
		t.Fatalf("container host: %v", err)
	}

	port, err := container.MappedPort(ctx, "3306/tcp")
	if err != nil {
		cleanup()
		t.Fatalf("mapped port: %v", err)
	}

	return fmt.Sprintf("sigil:sigil@tcp(%s:%s)/sigil?parseTime=true", host, port.Port()), cleanup
}
