package mysql

import "testing"

func TestWALWriteHealthTransitionsReadyState(t *testing.T) {
	health := newWALWriteHealth()

	for range walWriteFailureThreshold - 1 {
		if consecutive, degraded, becameDegraded := health.ObserveFailure(assertivePersistError("persist generation: driver: bad connection")); degraded || becameDegraded {
			t.Fatalf("expected health to stay ready before threshold, got degraded=%v becameDegraded=%v failures=%d", degraded, becameDegraded, consecutive)
		}
	}
	if err := health.Ready(); err != nil {
		t.Fatalf("expected health to stay ready below threshold, got %v", err)
	}

	consecutive, degraded, becameDegraded := health.ObserveFailure(assertivePersistError("persist generation: driver: bad connection"))
	if consecutive != walWriteFailureThreshold {
		t.Fatalf("expected consecutive failures %d, got %d", walWriteFailureThreshold, consecutive)
	}
	if !degraded || !becameDegraded {
		t.Fatalf("expected health to become degraded at threshold")
	}
	if err := health.Ready(); err == nil {
		t.Fatal("expected degraded readiness error")
	}

	if !health.ObserveSuccess() {
		t.Fatal("expected recovery transition after success")
	}
	if err := health.Ready(); err != nil {
		t.Fatalf("expected readiness recovery, got %v", err)
	}
}

type assertivePersistError string

func (e assertivePersistError) Error() string {
	return string(e)
}
