package mysql

import (
	"context"
	"fmt"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

func BenchmarkWALStoreSaveBatchSingle(b *testing.B) {
	store, cleanup := newBenchmarkWALStore(b)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		b.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 12, 0, 0, 0, time.UTC)
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		generation := testGeneration(
			fmt.Sprintf("bench-single-%d", i),
			"conv-bench-single",
			base.Add(time.Duration(i)*time.Millisecond),
		)
		errs := store.SaveBatch(context.Background(), "tenant-bench", []*sigilv1.Generation{generation})
		if len(errs) != 1 || errs[0] != nil {
			b.Fatalf("save batch failed at iteration %d: %v", i, errs)
		}
	}
}

func BenchmarkWALStoreSaveBatch100(b *testing.B) {
	store, cleanup := newBenchmarkWALStore(b)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		b.Fatalf("auto migrate: %v", err)
	}

	const batchSize = 100
	base := time.Date(2026, 2, 12, 12, 0, 0, 0, time.UTC)
	buffer := make([]*sigilv1.Generation, batchSize)
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		iterationBase := i * batchSize
		for j := 0; j < batchSize; j++ {
			idx := iterationBase + j
			buffer[j] = testGeneration(
				fmt.Sprintf("bench-batch-%d", idx),
				"conv-bench-batch",
				base.Add(time.Duration(idx)*time.Millisecond),
			)
		}
		errs := store.SaveBatch(context.Background(), "tenant-bench", buffer)
		for j, err := range errs {
			if err != nil {
				b.Fatalf("save batch failed at iteration %d row %d: %v", i, j, err)
			}
		}
	}
}

func BenchmarkClaimBatch(b *testing.B) {
	store, cleanup := newBenchmarkWALStore(b)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		b.Fatalf("auto migrate: %v", err)
	}

	const totalRows = 5000
	base := time.Date(2026, 2, 12, 13, 0, 0, 0, time.UTC)
	batch := make([]*sigilv1.Generation, 0, totalRows)
	for i := 0; i < totalRows; i++ {
		batch = append(batch, testGeneration(
			fmt.Sprintf("bench-claim-%d", i),
			"conv-bench-claim",
			base.Add(time.Duration(i)*time.Millisecond),
		))
	}
	errs := store.SaveBatch(context.Background(), "tenant-bench-claim", batch)
	for i, err := range errs {
		if err != nil {
			b.Fatalf("seed save batch failed at index %d: %v", i, err)
		}
	}

	pred := storage.ShardPredicate{ShardWindowSeconds: 60, ShardCount: 1, ShardID: 0}
	olderThan := time.Now().UTC().Add(time.Hour)
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		ownerID := fmt.Sprintf("bench-owner-%d", i)
		if _, err := store.ClaimBatch(context.Background(), "tenant-bench-claim", ownerID, pred, olderThan, 200); err != nil {
			b.Fatalf("claim batch failed at iteration %d: %v", i, err)
		}
		if err := clearClaimsByOwnerForBench(context.Background(), store, "tenant-bench-claim", ownerID); err != nil {
			b.Fatalf("clear claims failed at iteration %d: %v", i, err)
		}
	}
}

func BenchmarkBacklogDiscovery(b *testing.B) {
	store, cleanup := newBenchmarkWALStore(b)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		b.Fatalf("auto migrate: %v", err)
	}

	base := time.Date(2026, 2, 12, 14, 0, 0, 0, time.UTC)
	for tenant := 0; tenant < 25; tenant++ {
		tenantID := fmt.Sprintf("tenant-bench-%02d", tenant)
		rows := 50
		if tenant == 0 {
			rows = 2000
		}
		batch := make([]*sigilv1.Generation, 0, rows)
		for i := 0; i < rows; i++ {
			batch = append(batch, testGeneration(
				fmt.Sprintf("bench-discovery-%d-%d", tenant, i),
				fmt.Sprintf("conv-bench-%d", tenant),
				base.Add(time.Duration(i)*time.Second),
			))
		}
		errs := store.SaveBatch(context.Background(), tenantID, batch)
		for i, err := range errs {
			if err != nil {
				b.Fatalf("seed discovery batch failed for tenant %s index %d: %v", tenantID, i, err)
			}
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		shards, err := store.ListShardsForCompaction(context.Background(), 60, 8, 200)
		if err != nil {
			b.Fatalf("list shards failed at iteration %d: %v", i, err)
		}
		if len(shards) == 0 {
			b.Fatalf("expected non-empty shard discovery at iteration %d", i)
		}
	}
}

func newBenchmarkWALStore(b *testing.B) (*WALStore, func()) {
	b.Helper()

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
		b.Skipf("skip mysql benchmark (container start failed): %v", err)
	}

	cleanup := func() {
		_ = container.Terminate(context.Background())
	}

	host, err := container.Host(ctx)
	if err != nil {
		cleanup()
		b.Skipf("skip mysql benchmark (container host failed): %v", err)
	}

	port, err := container.MappedPort(ctx, "3306/tcp")
	if err != nil {
		cleanup()
		b.Skipf("skip mysql benchmark (mapped port failed): %v", err)
	}

	dsn := fmt.Sprintf("sigil:sigil@tcp(%s:%s)/sigil?parseTime=true", host, port.Port())
	var store *WALStore
	for i := 0; i < 30; i++ {
		store, err = NewWALStore(dsn)
		if err == nil {
			sqlDB, dbErr := store.DB().DB()
			if dbErr == nil && sqlDB.Ping() == nil {
				return store, cleanup
			}
		}
		time.Sleep(time.Second)
	}

	cleanup()
	b.Skipf("skip mysql benchmark (database not ready): %v", err)
	return nil, func() {}
}

func clearClaimsByOwnerForBench(ctx context.Context, store *WALStore, tenantID string, ownerID string) error {
	return store.DB().WithContext(ctx).
		Model(&GenerationModel{}).
		Where("tenant_id = ? AND claimed_by = ?", tenantID, ownerID).
		Where("compacted = FALSE").
		Updates(map[string]any{
			"claimed_by": nil,
			"claimed_at": nil,
		}).Error
}
