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

type ErrorClass string

const (
	ErrorClassRetryableLock       ErrorClass = "retryable_lock"
	ErrorClassRetryableConnection ErrorClass = "retryable_connection"
	ErrorClassNonRetryableSQL     ErrorClass = "non_retryable_sql"
	ErrorClassUnknown             ErrorClass = "unknown"
)

type ErrorDetails struct {
	Class      ErrorClass
	Retryable  bool
	MySQLErrno uint16
	SQLState   string
	Message    string
}

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
	return ClassifyError(err).Retryable
}

func ClassifyError(err error) ErrorDetails {
	if err == nil {
		return ErrorDetails{Class: ErrorClassUnknown}
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ErrorDetails{Class: ErrorClassUnknown, Message: err.Error()}
	}
	if errors.Is(err, driver.ErrBadConn) {
		return ErrorDetails{
			Class:     ErrorClassRetryableConnection,
			Retryable: true,
			Message:   driver.ErrBadConn.Error(),
		}
	}

	var mysqlErr *mysqlDriver.MySQLError
	if errors.As(err, &mysqlErr) {
		class := classifyMySQLErrorNumber(mysqlErr.Number)
		return ErrorDetails{
			Class:      class,
			Retryable:  class == ErrorClassRetryableLock || class == ErrorClassRetryableConnection,
			MySQLErrno: mysqlErr.Number,
			SQLState:   sqlStateString(mysqlErr.SQLState),
			Message:    mysqlErr.Message,
		}
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return ErrorDetails{
			Class:     ErrorClassRetryableConnection,
			Retryable: true,
			Message:   netErr.Error(),
		}
	}

	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "deadlock found when trying to get lock") ||
		strings.Contains(lower, "lock wait timeout exceeded") {
		return ErrorDetails{
			Class:     ErrorClassRetryableLock,
			Retryable: true,
			Message:   err.Error(),
		}
	}
	if strings.Contains(lower, "driver: bad connection") ||
		strings.Contains(lower, "server has gone away") ||
		strings.Contains(lower, "lost connection to mysql server during query") ||
		strings.Contains(lower, "connection reset by peer") ||
		strings.Contains(lower, "broken pipe") ||
		strings.Contains(lower, "i/o timeout") ||
		strings.Contains(lower, "connection refused") {
		return ErrorDetails{
			Class:     ErrorClassRetryableConnection,
			Retryable: true,
			Message:   err.Error(),
		}
	}

	return ErrorDetails{
		Class:   ErrorClassUnknown,
		Message: err.Error(),
	}
}

func classifyMySQLErrorNumber(number uint16) ErrorClass {
	switch number {
	case 1205, 1213:
		return ErrorClassRetryableLock
	case 1040, 1042, 1047, 1081, 1129, 1130, 1158, 1159, 1160, 1161, 1184:
		return ErrorClassRetryableConnection
	default:
		return ErrorClassNonRetryableSQL
	}
}

func sqlStateString(state [5]byte) string {
	if state == [5]byte{} {
		return ""
	}
	return string(state[:])
}
