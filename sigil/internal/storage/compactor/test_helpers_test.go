package compactor

import (
	"context"
	"fmt"
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

func newTestWALStore(t *testing.T) (*mysql.WALStore, func()) {
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
		t.Skipf("skip mysql integration tests (container start failed): %v", err)
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

	dsn := fmt.Sprintf("sigil:sigil@tcp(%s:%s)/sigil?parseTime=true", host, port.Port())
	var store *mysql.WALStore
	for i := 0; i < 30; i++ {
		store, err = mysql.NewWALStore(dsn)
		if err == nil {
			sqlDB, dbErr := store.DB().DB()
			if dbErr == nil && sqlDB.Ping() == nil {
				return store, cleanup
			}
		}
		time.Sleep(time.Second)
	}

	cleanup()
	t.Skipf("skip mysql integration tests (database not ready): %v", err)
	return nil, func() {}
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
