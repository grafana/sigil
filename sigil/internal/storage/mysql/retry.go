package mysql

import (
	"context"
	"errors"
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

	var mysqlErr *mysqlDriver.MySQLError
	if errors.As(err, &mysqlErr) {
		switch mysqlErr.Number {
		case 1205, 1213:
			return true
		}
	}

	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "deadlock found when trying to get lock") ||
		strings.Contains(lower, "lock wait timeout exceeded")
}
