package mysql

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

const walWriteFailureThreshold = 3

type walWriteHealth struct {
	mu                  sync.RWMutex
	consecutiveFailures int
	lastFailureAt       time.Time
	lastError           string
}

func newWALWriteHealth() *walWriteHealth {
	return &walWriteHealth{}
}

func (h *walWriteHealth) ObserveSuccess() (recovered bool) {
	if h == nil {
		return false
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	recovered = h.consecutiveFailures >= walWriteFailureThreshold
	h.consecutiveFailures = 0
	h.lastFailureAt = time.Time{}
	h.lastError = ""
	return recovered
}

func (h *walWriteHealth) ObserveFailure(err error) (consecutive int, degraded bool, becameDegraded bool) {
	if h == nil || !shouldTrackWALWriteFailure(err) {
		return 0, false, false
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	wasDegraded := h.consecutiveFailures >= walWriteFailureThreshold
	h.consecutiveFailures++
	h.lastFailureAt = time.Now().UTC()
	h.lastError = err.Error()

	degraded = h.consecutiveFailures >= walWriteFailureThreshold
	return h.consecutiveFailures, degraded, degraded && !wasDegraded
}

func (h *walWriteHealth) Ready() error {
	if h == nil {
		return nil
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	if h.consecutiveFailures < walWriteFailureThreshold {
		return nil
	}

	if h.lastFailureAt.IsZero() {
		return fmt.Errorf("wal writes degraded after %d consecutive failures", h.consecutiveFailures)
	}

	return fmt.Errorf(
		"wal writes degraded after %d consecutive failures; last failure at %s: %s",
		h.consecutiveFailures,
		h.lastFailureAt.Format(time.RFC3339),
		h.lastError,
	)
}

func shouldTrackWALWriteFailure(err error) bool {
	if err == nil {
		return false
	}
	return !errors.Is(err, ErrGenerationAlreadyExists)
}
