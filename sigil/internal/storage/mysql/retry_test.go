package mysql

import (
	"context"
	"database/sql/driver"
	"errors"
	"testing"

	mysqlDriver "github.com/go-sql-driver/mysql"
)

func TestRunWithRetryableLockErrorAttemptsRetriesAndSucceeds(t *testing.T) {
	lockErr := &mysqlDriver.MySQLError{Number: 1213, Message: "Deadlock found when trying to get lock; try restarting transaction"}

	attempts := 0
	err := runWithRetryableLockErrorAttempts(context.Background(), 3, func() error {
		attempts++
		if attempts < 3 {
			return lockErr
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected retry to eventually succeed, got %v", err)
	}
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
}

func TestRunWithRetryableLockErrorAttemptsStopsAtLimit(t *testing.T) {
	lockErr := &mysqlDriver.MySQLError{Number: 1213, Message: "Deadlock found when trying to get lock; try restarting transaction"}

	attempts := 0
	err := runWithRetryableLockErrorAttempts(context.Background(), 2, func() error {
		attempts++
		return lockErr
	})
	if !errors.Is(err, lockErr) {
		t.Fatalf("expected lock error to be returned, got %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected 2 attempts, got %d", attempts)
	}
}

func TestRunWithRetryableLockErrorAttemptsDoesNotRetryNonRetryableError(t *testing.T) {
	nonRetryableErr := errors.New("write failed")

	attempts := 0
	err := runWithRetryableLockErrorAttempts(context.Background(), 3, func() error {
		attempts++
		return nonRetryableErr
	})
	if !errors.Is(err, nonRetryableErr) {
		t.Fatalf("expected non-retryable error to be returned, got %v", err)
	}
	if attempts != 1 {
		t.Fatalf("expected 1 attempt for non-retryable error, got %d", attempts)
	}
}

func TestRunWithRetryableLockErrorAttemptsRetriesTransientConnectionErrors(t *testing.T) {
	attempts := 0
	err := runWithRetryableLockErrorAttempts(context.Background(), 3, func() error {
		attempts++
		if attempts < 3 {
			return driver.ErrBadConn
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected retry to eventually succeed, got %v", err)
	}
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
}

func TestRunWithRetryableLockErrorAttemptsHonorsCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	attempts := 0
	err := runWithRetryableLockErrorAttempts(ctx, 3, func() error {
		attempts++
		return &mysqlDriver.MySQLError{Number: 1213, Message: "Deadlock found when trying to get lock; try restarting transaction"}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if attempts != 0 {
		t.Fatalf("expected 0 attempts after cancellation, got %d", attempts)
	}
}

func TestIsRetryableLockError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "mysql deadlock code",
			err:  &mysqlDriver.MySQLError{Number: 1213},
			want: true,
		},
		{
			name: "mysql lock wait timeout code",
			err:  &mysqlDriver.MySQLError{Number: 1205},
			want: true,
		},
		{
			name: "wrapped deadlock string",
			err:  errors.New("persist generation: Deadlock found when trying to get lock"),
			want: true,
		},
		{
			name: "non lock error",
			err:  errors.New("validation failed"),
			want: false,
		},
		{
			name: "driver bad connection",
			err:  driver.ErrBadConn,
			want: true,
		},
		{
			name: "nil error",
			err:  nil,
			want: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := IsRetryableLockError(tc.err)
			if got != tc.want {
				t.Fatalf("IsRetryableLockError(%v)=%v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestClassifyError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want ErrorDetails
	}{
		{
			name: "retryable lock mysql error",
			err: &mysqlDriver.MySQLError{
				Number:   1213,
				SQLState: [5]byte{'4', '0', '0', '0', '1'},
				Message:  "Deadlock found when trying to get lock; try restarting transaction",
			},
			want: ErrorDetails{
				Class:      ErrorClassRetryableLock,
				Retryable:  true,
				MySQLErrno: 1213,
				SQLState:   "40001",
				Message:    "Deadlock found when trying to get lock; try restarting transaction",
			},
		},
		{
			name: "retryable connection driver error",
			err:  driver.ErrBadConn,
			want: ErrorDetails{
				Class:     ErrorClassRetryableConnection,
				Retryable: true,
				Message:   driver.ErrBadConn.Error(),
			},
		},
		{
			name: "non retryable mysql sql error",
			err: &mysqlDriver.MySQLError{
				Number:   1064,
				SQLState: [5]byte{'4', '2', '0', '0', '0'},
				Message:  "You have an error in your SQL syntax",
			},
			want: ErrorDetails{
				Class:      ErrorClassNonRetryableSQL,
				Retryable:  false,
				MySQLErrno: 1064,
				SQLState:   "42000",
				Message:    "You have an error in your SQL syntax",
			},
		},
		{
			name: "unknown generic error",
			err:  errors.New("boom"),
			want: ErrorDetails{
				Class:   ErrorClassUnknown,
				Message: "boom",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyError(tc.err)
			if got != tc.want {
				t.Fatalf("ClassifyError(%v)=%+v, want %+v", tc.err, got, tc.want)
			}
		})
	}
}
