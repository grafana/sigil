package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"gorm.io/gorm"
)

const defaultMigrateLockTimeout = 120 * time.Second

// withMigrateLock serialises schema migrations across all microservice replicas
// using a MySQL advisory lock (GET_LOCK / RELEASE_LOCK). Advisory locks are
// session-scoped — if the holder crashes, MySQL releases the lock automatically.
//
// The lock name should be unique per migration domain (e.g. WAL tables vs.
// model-card tables) so independent migration sets do not block each other.
func withMigrateLock(ctx context.Context, db *gorm.DB, lockName string, fn func() error) error {
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("get sql.DB for migration lock: %w", err)
	}

	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire dedicated connection for migration lock %q: %w", lockName, err)
	}
	defer func() { _ = conn.Close() }()

	timeoutSec := lockTimeoutSeconds(ctx)

	var result sql.NullInt64
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK(?, ?)", lockName, timeoutSec).Scan(&result); err != nil {
		return fmt.Errorf("GET_LOCK(%q, %d): %w", lockName, timeoutSec, err)
	}
	if !result.Valid || result.Int64 != 1 {
		return fmt.Errorf("migration lock %q: timed out after %ds waiting for another instance to finish migrating", lockName, timeoutSec)
	}
	defer func() {
		// Best-effort release; the lock is freed when the connection closes anyway.
		_, _ = conn.ExecContext(context.Background(), "SELECT RELEASE_LOCK(?)", lockName)
	}()

	return fn()
}

// lockTimeoutSeconds derives an integer timeout from the context deadline,
// falling back to defaultMigrateLockTimeout when no deadline is set.
func lockTimeoutSeconds(ctx context.Context) int {
	deadline, ok := ctx.Deadline()
	if !ok {
		return int(defaultMigrateLockTimeout.Seconds())
	}
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return 1
	}
	sec := int(remaining.Seconds())
	if sec <= 0 {
		return 1
	}
	return sec
}
