package compactor

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-kit/log"
	"github.com/grafana/sigil/sigil/internal/config"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	compactorTestMySQLImage    = "mysql:8.4"
	compactorTestMySQLRootPass = "rootpass"
)

var (
	compactorMySQLOnce      sync.Once
	compactorMySQLContainer testcontainers.Container
	compactorMySQLHost      string
	compactorMySQLPort      string
	compactorMySQLErr       error
	compactorDBSeq          atomic.Uint64
)

func TestMain(m *testing.M) {
	code := m.Run()
	if compactorMySQLContainer != nil {
		_ = compactorMySQLContainer.Terminate(context.Background())
	}
	os.Exit(code)
}

func newTestWALStore(t *testing.T) (*mysql.WALStore, func()) {
	t.Helper()

	host, port := ensureCompactorMySQLContainer(t)
	adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", compactorTestMySQLRootPass, host, port)
	dbName := fmt.Sprintf("sigil_compactor_test_%d", compactorDBSeq.Add(1))

	if err := createCompactorTestDatabase(adminDSN, dbName); err != nil {
		t.Fatalf("create compactor test database %q: %v", dbName, err)
	}

	dsn := fmt.Sprintf("root:%s@tcp(%s:%s)/%s?parseTime=true", compactorTestMySQLRootPass, host, port, dbName)
	store, err := mysql.NewWALStore(dsn)
	if err != nil {
		_ = dropCompactorTestDatabase(adminDSN, dbName)
		t.Fatalf("open compactor test wal store for %q: %v", dbName, err)
	}
	sqlDB, err := store.DB().DB()
	if err != nil {
		_ = dropCompactorTestDatabase(adminDSN, dbName)
		t.Fatalf("open compactor test sql db for %q: %v", dbName, err)
	}
	if err := sqlDB.Ping(); err != nil {
		_ = sqlDB.Close()
		_ = dropCompactorTestDatabase(adminDSN, dbName)
		t.Fatalf("ping compactor test sql db for %q: %v", dbName, err)
	}

	cleanup := func() {
		_ = sqlDB.Close()
		if err := dropCompactorTestDatabase(adminDSN, dbName); err != nil {
			t.Logf("drop compactor test database %q: %v", dbName, err)
		}
	}
	return store, cleanup
}

func ensureCompactorMySQLContainer(t *testing.T) (string, string) {
	t.Helper()

	compactorMySQLOnce.Do(func() {
		ctx := context.Background()
		container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
			ContainerRequest: testcontainers.ContainerRequest{
				Image:        compactorTestMySQLImage,
				ExposedPorts: []string{"3306/tcp"},
				Env: map[string]string{
					"MYSQL_DATABASE":      "sigil",
					"MYSQL_USER":          "sigil",
					"MYSQL_PASSWORD":      "sigil",
					"MYSQL_ROOT_PASSWORD": compactorTestMySQLRootPass,
				},
				WaitingFor: wait.ForListeningPort("3306/tcp").WithStartupTimeout(2 * time.Minute),
			},
			Started: true,
		})
		if err != nil {
			compactorMySQLErr = err
			return
		}

		host, err := container.Host(ctx)
		if err != nil {
			_ = container.Terminate(context.Background())
			compactorMySQLErr = err
			return
		}
		mappedPort, err := container.MappedPort(ctx, "3306/tcp")
		if err != nil {
			_ = container.Terminate(context.Background())
			compactorMySQLErr = err
			return
		}

		compactorMySQLContainer = container
		compactorMySQLHost = host
		compactorMySQLPort = mappedPort.Port()

		adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", compactorTestMySQLRootPass, compactorMySQLHost, compactorMySQLPort)
		var readyErr error
		for i := 0; i < 30; i++ {
			store, openErr := mysql.NewWALStore(adminDSN)
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
			compactorMySQLContainer = nil
			compactorMySQLErr = readyErr
		}
	})

	if compactorMySQLErr != nil {
		t.Skipf("skip compactor mysql tests (shared container unavailable): %v", compactorMySQLErr)
	}
	if compactorMySQLContainer == nil {
		t.Skip("skip compactor mysql tests (shared container unavailable)")
	}
	return compactorMySQLHost, compactorMySQLPort
}

func createCompactorTestDatabase(adminDSN, dbName string) error {
	store, err := mysql.NewWALStore(adminDSN)
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

func dropCompactorTestDatabase(adminDSN, dbName string) error {
	store, err := mysql.NewWALStore(adminDSN)
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

func newTestService(
	store *mysql.WALStore,
	ownerID string,
	blockWriter storage.BlockWriter,
	metadataStore storage.BlockMetadataStore,
) *Service {
	if metadataStore == nil {
		metadataStore = store
	}
	return &Service{
		cfg: config.CompactorConfig{
			CompactInterval:    time.Minute,
			TruncateInterval:   time.Minute,
			Retention:          time.Hour,
			BatchSize:          1000,
			LeaseTTL:           30 * time.Second,
			ShardCount:         1,
			ShardWindowSeconds: 60,
			Workers:            1,
			CycleBudget:        30 * time.Second,
			ClaimTTL:           5 * time.Minute,
			TargetBlockBytes:   64 * 1024 * 1024,
		},
		logger:        log.NewNopLogger(),
		ownerID:       ownerID,
		discoverer:    store,
		leaser:        store,
		claimer:       store,
		truncator:     store,
		blockWriter:   blockWriter,
		metadataStore: metadataStore,
	}
}

func mustSaveGenerations(t *testing.T, store *mysql.WALStore, tenantID string, generations []*sigilv1.Generation) {
	t.Helper()

	errs := store.SaveBatch(context.Background(), tenantID, generations)
	for i, err := range errs {
		if err != nil {
			t.Fatalf("save batch index %d: %v", i, err)
		}
	}
}

func testGeneration(id, conversationID string, completedAt time.Time) *sigilv1.Generation {
	return &sigilv1.Generation{
		Id:             id,
		ConversationId: conversationID,
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		StartedAt:      timestamppb.New(completedAt.Add(-time.Second)),
		CompletedAt:    timestamppb.New(completedAt),
	}
}

type failingBlockWriter struct {
	err error
}

func (f failingBlockWriter) WriteBlock(_ context.Context, _ string, _ *storage.Block) error {
	return f.err
}

type failingMetadataStore struct {
	err error
}

func (f failingMetadataStore) InsertBlock(_ context.Context, _ storage.BlockMeta) error {
	return f.err
}

func (f failingMetadataStore) ListBlocks(_ context.Context, _ string, _, _ time.Time) ([]storage.BlockMeta, error) {
	return nil, f.err
}
