package sigil

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-kit/log"
	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	mysqlstorage "github.com/grafana/sigil/sigil/internal/storage/mysql"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	runtimeTestMySQLImage    = "mysql:8.4"
	runtimeTestMySQLRootPass = "rootpass"
)

var (
	runtimeMySQLOnce      sync.Once
	runtimeMySQLContainer testcontainers.Container
	runtimeMySQLHost      string
	runtimeMySQLPort      string
	runtimeMySQLErr       error
	runtimeDBSeq          atomic.Uint64
)

func TestMain(m *testing.M) {
	code := m.Run()
	if runtimeMySQLContainer != nil {
		_ = runtimeMySQLContainer.Terminate(context.Background())
	}
	os.Exit(code)
}

func TestRuntimeAllTargetFailsWithoutCompactorDependencies(t *testing.T) {
	cfg := testRuntimeConfigWithoutValidation(t, config.TargetAll)
	cfg.StorageBackend = "memory"
	_, done := runRuntime(t, cfg)

	err := awaitRuntimeError(t, done)
	if !strings.Contains(err.Error(), "requires mysql storage backend") {
		t.Fatalf("unexpected runtime error: %v", err)
	}
}

func TestRuntimePlaceholderTargetsRemainHealthyUntilCanceled(t *testing.T) {
	dsn, cleanup := newTestMySQLDSN(t)
	defer cleanup()

	targets := []string{config.TargetIngester, config.TargetQuerier, config.TargetCatalogSync}

	for _, target := range targets {
		t.Run(target, func(t *testing.T) {
			cfg := testRuntimeConfig(t, target)
			cfg.MySQLDSN = dsn
			cancel, done := runRuntime(t, cfg)

			time.Sleep(200 * time.Millisecond)

			cancel()
			if err := <-done; err != nil && !errors.Is(err, context.Canceled) && !strings.Contains(err.Error(), "context canceled") {
				t.Fatalf("runtime returned error: %v", err)
			}
		})
	}
}

func TestRuntimeModelCardServiceIsSingleton(t *testing.T) {
	dsn, cleanup := newTestMySQLDSN(t)
	defer cleanup()

	cfg := testRuntimeConfig(t, config.TargetAll)
	cfg.MySQLDSN = dsn
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

func TestInitQuerierModuleUsesTimeoutBoundContextForModelCardBootstrap(t *testing.T) {
	cfg := testRuntimeConfigWithoutValidation(t, config.TargetQuerier)
	runtime, err := NewRuntime(cfg, log.NewNopLogger())
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}

	sentinel := errors.New("model-card bootstrap sentinel")
	var hasDeadline bool
	runtime.modelCardBuilder = func(ctx context.Context, _ config.Config, _ bool) (*modelcards.Service, error) {
		_, hasDeadline = ctx.Deadline()
		return nil, sentinel
	}

	_, err = runtime.initQuerierModule()
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected sentinel error from model-card bootstrap, got: %v", err)
	}
	if !hasDeadline {
		t.Fatalf("expected timeout-bound context for model-card bootstrap")
	}
}

func TestInitCatalogSyncModuleUsesTimeoutBoundContextForModelCardBootstrap(t *testing.T) {
	cfg := testRuntimeConfigWithoutValidation(t, config.TargetCatalogSync)
	runtime, err := NewRuntime(cfg, log.NewNopLogger())
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}

	sentinel := errors.New("model-card bootstrap sentinel")
	var hasDeadline bool
	runtime.modelCardBuilder = func(ctx context.Context, _ config.Config, _ bool) (*modelcards.Service, error) {
		_, hasDeadline = ctx.Deadline()
		return nil, sentinel
	}

	_, err = runtime.initCatalogSyncModule()
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected sentinel error from model-card bootstrap, got: %v", err)
	}
	if !hasDeadline {
		t.Fatalf("expected timeout-bound context for model-card bootstrap")
	}
}

func TestRuntimeCompactorTargetFailsWithoutMySQLBackend(t *testing.T) {
	cfg := testRuntimeConfigWithoutValidation(t, config.TargetCompactor)
	cfg.StorageBackend = "memory"
	_, done := runRuntime(t, cfg)

	err := awaitRuntimeError(t, done)
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

func awaitRuntimeError(t *testing.T, done <-chan error) error {
	t.Helper()

	select {
	case err := <-done:
		if err == nil {
			t.Fatalf("expected runtime error")
		}
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for runtime error")
	}
	return nil
}

func testRuntimeConfig(t *testing.T, target string) config.Config {
	t.Helper()

	cfg := testRuntimeConfigWithoutValidation(t, target)
	if err := cfg.Validate(); err != nil {
		t.Fatalf("config validation failed: %v", err)
	}
	return cfg
}

func testRuntimeConfigWithoutValidation(t *testing.T, target string) config.Config {
	t.Helper()

	cfg := config.FromEnv()
	cfg.HTTPAddr = randomLocalAddr(t)
	cfg.OTLPGRPCAddr = randomLocalAddr(t)
	cfg.AuthEnabled = false
	cfg.StorageBackend = "mysql"
	cfg.Target = target
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

	host, port := ensureRuntimeMySQLContainer(t)
	adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", runtimeTestMySQLRootPass, host, port)
	dbName := fmt.Sprintf("sigil_runtime_test_%d", runtimeDBSeq.Add(1))

	if err := createRuntimeTestDatabase(adminDSN, dbName); err != nil {
		t.Fatalf("create runtime test database %q: %v", dbName, err)
	}

	dsn := fmt.Sprintf("root:%s@tcp(%s:%s)/%s?parseTime=true", runtimeTestMySQLRootPass, host, port, dbName)
	store, err := mysqlstorage.NewWALStore(dsn)
	if err != nil {
		_ = dropRuntimeTestDatabase(adminDSN, dbName)
		t.Fatalf("open runtime test wal store for %q: %v", dbName, err)
	}
	sqlDB, err := store.DB().DB()
	if err != nil {
		_ = dropRuntimeTestDatabase(adminDSN, dbName)
		t.Fatalf("open runtime test sql db for %q: %v", dbName, err)
	}
	if err := sqlDB.Ping(); err != nil {
		_ = sqlDB.Close()
		_ = dropRuntimeTestDatabase(adminDSN, dbName)
		t.Fatalf("ping runtime test sql db for %q: %v", dbName, err)
	}

	cleanup := func() {
		_ = sqlDB.Close()
		if err := dropRuntimeTestDatabase(adminDSN, dbName); err != nil {
			t.Logf("drop runtime test database %q: %v", dbName, err)
		}
	}
	return dsn, cleanup
}

func ensureRuntimeMySQLContainer(t *testing.T) (string, string) {
	t.Helper()

	runtimeMySQLOnce.Do(func() {
		ctx := context.Background()
		container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
			ContainerRequest: testcontainers.ContainerRequest{
				Image:        runtimeTestMySQLImage,
				ExposedPorts: []string{"3306/tcp"},
				Env: map[string]string{
					"MYSQL_DATABASE":      "sigil",
					"MYSQL_USER":          "sigil",
					"MYSQL_PASSWORD":      "sigil",
					"MYSQL_ROOT_PASSWORD": runtimeTestMySQLRootPass,
				},
				WaitingFor: wait.ForListeningPort("3306/tcp").WithStartupTimeout(2 * time.Minute),
			},
			Started: true,
		})
		if err != nil {
			runtimeMySQLErr = err
			return
		}

		host, err := container.Host(ctx)
		if err != nil {
			_ = container.Terminate(context.Background())
			runtimeMySQLErr = err
			return
		}
		mappedPort, err := container.MappedPort(ctx, "3306/tcp")
		if err != nil {
			_ = container.Terminate(context.Background())
			runtimeMySQLErr = err
			return
		}

		runtimeMySQLContainer = container
		runtimeMySQLHost = host
		runtimeMySQLPort = mappedPort.Port()

		adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", runtimeTestMySQLRootPass, runtimeMySQLHost, runtimeMySQLPort)
		var readyErr error
		for i := 0; i < 30; i++ {
			store, openErr := mysqlstorage.NewWALStore(adminDSN)
			if openErr == nil {
				sqlDB, dbErr := store.DB().DB()
				if dbErr == nil && sqlDB.Ping() == nil {
					_ = sqlDB.Close()
					readyErr = nil
					break
				}
				if dbErr == nil {
					_ = sqlDB.Close()
				}
				if dbErr != nil {
					readyErr = dbErr
				}
			} else {
				readyErr = openErr
			}
			time.Sleep(time.Second)
		}
		if readyErr != nil {
			_ = container.Terminate(context.Background())
			runtimeMySQLContainer = nil
			runtimeMySQLErr = readyErr
		}
	})

	if runtimeMySQLErr != nil {
		t.Skipf("skip mysql runtime tests (shared container unavailable): %v", runtimeMySQLErr)
	}
	if runtimeMySQLContainer == nil {
		t.Skip("skip mysql runtime tests (shared container unavailable)")
	}
	return runtimeMySQLHost, runtimeMySQLPort
}

func createRuntimeTestDatabase(adminDSN, dbName string) error {
	store, err := mysqlstorage.NewWALStore(adminDSN)
	if err != nil {
		return err
	}
	sqlDB, err := store.DB().DB()
	if err != nil {
		return err
	}
	defer func() {
		_ = sqlDB.Close()
	}()

	query := fmt.Sprintf("CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", dbName)
	return store.DB().Exec(query).Error
}

func dropRuntimeTestDatabase(adminDSN, dbName string) error {
	store, err := mysqlstorage.NewWALStore(adminDSN)
	if err != nil {
		return err
	}
	sqlDB, err := store.DB().DB()
	if err != nil {
		return err
	}
	defer func() {
		_ = sqlDB.Close()
	}()

	query := fmt.Sprintf("DROP DATABASE IF EXISTS `%s`", dbName)
	return store.DB().Exec(query).Error
}
