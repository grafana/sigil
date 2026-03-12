package mysql

import (
	"context"
	"database/sql/driver"
	"errors"
	"net"
	"strings"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
)

const (
	defaultLockRetryAttempts = 3
	initialRetryBackoff      = 25 * time.Millisecond
	maxRetryBackoff          = 200 * time.Millisecond
)

func runWithRetryableLockError(ctx context.Context, op func() error) error {
	return runWithRetryableLockErrorAttempts(ctx, defaultLockRetryAttempts, op)
}

func runWithRetryableLockErrorAttempts(ctx context.Context, attempts int, op func() error) error {
	if attempts <= 0 {
		attempts = 1
	}

	backoff := initialRetryBackoff
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		err := op()
		if err == nil {
			return nil
		}
		lastErr = err
		if !IsRetryableLockError(err) || attempt == attempts-1 {
			return err
		}

		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return ctx.Err()
		case <-timer.C:
		}
		if backoff < maxRetryBackoff {
			backoff *= 2
			if backoff > maxRetryBackoff {
				backoff = maxRetryBackoff
			}
		}
	}
	return lastErr
}

func IsRetryableLockError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	if errors.Is(err, driver.ErrBadConn) {
		return true
	}

	var mysqlErr *mysqlDriver.MySQLError
	if errors.As(err, &mysqlErr) {
		switch mysqlErr.Number {
		case 1040, 1042, 1047, 1081, 1129, 1130, 1158, 1159, 1160, 1161, 1184, 1205, 1213:
			return true
		}
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}

	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "deadlock found when trying to get lock") ||
		strings.Contains(lower, "lock wait timeout exceeded") ||
		strings.Contains(lower, "driver: bad connection") ||
		strings.Contains(lower, "server has gone away") ||
		strings.Contains(lower, "lost connection to mysql server during query") ||
		strings.Contains(lower, "connection reset by peer") ||
		strings.Contains(lower, "broken pipe") ||
		strings.Contains(lower, "i/o timeout") ||
		strings.Contains(lower, "connection refused")
}
