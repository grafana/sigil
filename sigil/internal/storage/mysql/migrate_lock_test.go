package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWithMigrateLockSerialises(t *testing.T) {
	host, port := ensureSharedMySQLContainer(t)

	dbName := fmt.Sprintf("sigil_lock_test_%d", testDatabaseSeq.Add(1))
	adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", testMySQLRootPass, host, port)
	if err := createTestDatabase(adminDSN, dbName); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		_ = dropTestDatabase(adminDSN, dbName)
	})

	testDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/%s?parseTime=true", testMySQLRootPass, host, port, dbName)

	storeA, err := NewWALStore(testDSN)
	if err != nil {
		t.Fatalf("open store A: %v", err)
	}
	t.Cleanup(func() {
		if db, err := storeA.DB().DB(); err == nil {
			_ = db.Close()
		}
	})

	storeB, err := NewWALStore(testDSN)
	if err != nil {
		t.Fatalf("open store B: %v", err)
	}
	t.Cleanup(func() {
		if db, err := storeB.DB().DB(); err == nil {
			_ = db.Close()
		}
	})

	var concurrentMax atomic.Int32
	var running atomic.Int32
	var wg sync.WaitGroup

	slowMigration := func(db *WALStore) {
		defer wg.Done()
		err := withMigrateLock(context.Background(), db.DB(), "test_serialise", func() error {
			cur := running.Add(1)
			defer running.Add(-1)

			for {
				prev := concurrentMax.Load()
				if cur <= prev || concurrentMax.CompareAndSwap(prev, cur) {
					break
				}
			}

			time.Sleep(200 * time.Millisecond)
			return nil
		})
		if err != nil {
			t.Errorf("withMigrateLock failed: %v", err)
		}
	}

	wg.Add(2)
	go slowMigration(storeA)
	go slowMigration(storeB)
	wg.Wait()

	if max := concurrentMax.Load(); max != 1 {
		t.Fatalf("expected max concurrency 1 inside lock, got %d", max)
	}
}

func TestWithMigrateLockReleasesOnPanic(t *testing.T) {
	host, port := ensureSharedMySQLContainer(t)

	dbName := fmt.Sprintf("sigil_lock_panic_%d", testDatabaseSeq.Add(1))
	adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", testMySQLRootPass, host, port)
	if err := createTestDatabase(adminDSN, dbName); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		_ = dropTestDatabase(adminDSN, dbName)
	})

	testDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/%s?parseTime=true", testMySQLRootPass, host, port, dbName)

	store, err := NewWALStore(testDSN)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		if db, err := store.DB().DB(); err == nil {
			_ = db.Close()
		}
	})

	func() {
		defer func() { _ = recover() }()
		_ = withMigrateLock(context.Background(), store.DB(), "test_panic_release", func() error {
			panic("boom")
		})
	}()

	// After the panic, the lock should be released (connection closed).
	// Verify we can acquire the same lock immediately.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err = withMigrateLock(ctx, store.DB(), "test_panic_release", func() error {
		return nil
	})
	if err != nil {
		t.Fatalf("expected lock to be available after panic, got: %v", err)
	}
}

func TestWithMigrateLockReturnsCallbackError(t *testing.T) {
	host, port := ensureSharedMySQLContainer(t)

	dbName := fmt.Sprintf("sigil_lock_err_%d", testDatabaseSeq.Add(1))
	adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", testMySQLRootPass, host, port)
	if err := createTestDatabase(adminDSN, dbName); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		_ = dropTestDatabase(adminDSN, dbName)
	})

	testDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/%s?parseTime=true", testMySQLRootPass, host, port, dbName)

	store, err := NewWALStore(testDSN)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		if db, err := store.DB().DB(); err == nil {
			_ = db.Close()
		}
	})

	wantErr := fmt.Errorf("migration kaboom")
	gotErr := withMigrateLock(context.Background(), store.DB(), "test_error_passthrough", func() error {
		return wantErr
	})
	if gotErr != wantErr {
		t.Fatalf("expected error %v, got %v", wantErr, gotErr)
	}
}

func TestWithMigrateLockContextCancelled(t *testing.T) {
	host, port := ensureSharedMySQLContainer(t)

	dbName := fmt.Sprintf("sigil_lock_ctx_%d", testDatabaseSeq.Add(1))
	adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", testMySQLRootPass, host, port)
	if err := createTestDatabase(adminDSN, dbName); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		_ = dropTestDatabase(adminDSN, dbName)
	})

	testDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/%s?parseTime=true", testMySQLRootPass, host, port, dbName)

	// Hold the lock on a raw connection so the test store can't acquire it.
	rawDB, err := sql.Open("mysql", testDSN)
	if err != nil {
		t.Fatalf("open raw db: %v", err)
	}
	t.Cleanup(func() { _ = rawDB.Close() })

	conn, err := rawDB.Conn(context.Background())
	if err != nil {
		t.Fatalf("get raw conn: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	var lockResult sql.NullInt64
	if err := conn.QueryRowContext(context.Background(), "SELECT GET_LOCK('test_ctx_cancel', 5)").Scan(&lockResult); err != nil {
		t.Fatalf("acquire blocking lock: %v", err)
	}
	if !lockResult.Valid || lockResult.Int64 != 1 {
		t.Fatalf("failed to acquire blocking lock")
	}
	defer func() {
		_, _ = conn.ExecContext(context.Background(), "SELECT RELEASE_LOCK('test_ctx_cancel')")
	}()

	store, err := NewWALStore(testDSN)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		if db, err := store.DB().DB(); err == nil {
			_ = db.Close()
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	gotErr := withMigrateLock(ctx, store.DB(), "test_ctx_cancel", func() error {
		return nil
	})
	if gotErr == nil {
		t.Fatalf("expected error when context cancelled while waiting for lock")
	}
}

func TestLockTimeoutSeconds(t *testing.T) {
	tests := []struct {
		name    string
		timeout time.Duration
		hasCtx  bool
		wantMin int
		wantMax int
	}{
		{
			name:    "no deadline uses default",
			hasCtx:  false,
			wantMin: int(defaultMigrateLockTimeout.Seconds()),
			wantMax: int(defaultMigrateLockTimeout.Seconds()),
		},
		{
			name:    "short deadline",
			hasCtx:  true,
			timeout: 5 * time.Second,
			wantMin: 4,
			wantMax: 5,
		},
		{
			name:    "long deadline",
			hasCtx:  true,
			timeout: 2 * time.Minute,
			wantMin: 119,
			wantMax: 120,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var ctx context.Context
			if tt.hasCtx {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(context.Background(), tt.timeout)
				defer cancel()
			} else {
				ctx = context.Background()
			}

			got := lockTimeoutSeconds(ctx)
			if got < tt.wantMin || got > tt.wantMax {
				t.Errorf("lockTimeoutSeconds() = %d, want [%d, %d]", got, tt.wantMin, tt.wantMax)
			}
		})
	}
}

func TestAutoMigrateWithLockConcurrent(t *testing.T) {
	storeA, cleanupA := newTestWALStore(t)
	defer cleanupA()

	storeB, cleanupB := newTestWALStore(t)
	defer cleanupB()

	// Both stores point to different databases, but if they shared one, the
	// advisory lock would serialise them. Here we verify that concurrent
	// AutoMigrate calls on separate databases succeed (no deadlocks).
	var wg sync.WaitGroup
	wg.Add(2)

	var errA, errB error
	go func() {
		defer wg.Done()
		errA = storeA.AutoMigrate(context.Background())
	}()
	go func() {
		defer wg.Done()
		errB = storeB.AutoMigrate(context.Background())
	}()

	wg.Wait()

	if errA != nil {
		t.Fatalf("store A auto-migrate: %v", errA)
	}
	if errB != nil {
		t.Fatalf("store B auto-migrate: %v", errB)
	}
}

func TestAutoMigrateWithLockSameDB(t *testing.T) {
	host, port := ensureSharedMySQLContainer(t)

	dbName := fmt.Sprintf("sigil_lock_samedb_%d", testDatabaseSeq.Add(1))
	adminDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/mysql?parseTime=true", testMySQLRootPass, host, port)
	if err := createTestDatabase(adminDSN, dbName); err != nil {
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		_ = dropTestDatabase(adminDSN, dbName)
	})

	testDSN := fmt.Sprintf("root:%s@tcp(%s:%s)/%s?parseTime=true", testMySQLRootPass, host, port, dbName)

	storeA, err := NewWALStore(testDSN)
	if err != nil {
		t.Fatalf("open store A: %v", err)
	}
	t.Cleanup(func() {
		if db, err := storeA.DB().DB(); err == nil {
			_ = db.Close()
		}
	})

	storeB, err := NewWALStore(testDSN)
	if err != nil {
		t.Fatalf("open store B: %v", err)
	}
	t.Cleanup(func() {
		if db, err := storeB.DB().DB(); err == nil {
			_ = db.Close()
		}
	})

	// Two stores pointing at the same database, migrating concurrently.
	// The advisory lock should serialise them — both must succeed.
	var wg sync.WaitGroup
	wg.Add(2)

	var errA, errB error
	go func() {
		defer wg.Done()
		errA = storeA.AutoMigrate(context.Background())
	}()
	go func() {
		defer wg.Done()
		errB = storeB.AutoMigrate(context.Background())
	}()

	wg.Wait()

	if errA != nil {
		t.Fatalf("store A auto-migrate: %v", errA)
	}
	if errB != nil {
		t.Fatalf("store B auto-migrate: %v", errB)
	}

	migrator := storeA.DB().Migrator()
	if !migrator.HasTable(&GenerationModel{}) {
		t.Fatalf("expected generations table after concurrent migrate")
	}
	if !migrator.HasTable(&ConversationModel{}) {
		t.Fatalf("expected conversations table after concurrent migrate")
	}
}
