package control

import (
	"errors"
	"testing"
)

func TestControlErrorHelpers(t *testing.T) {
	t.Run("error fallbacks", func(t *testing.T) {
		var nilErr *ControlError
		if got := nilErr.Error(); got != "" {
			t.Fatalf("expected empty string for nil receiver, got %q", got)
		}

		if got := (&ControlError{Message: "boom"}).Error(); got != "boom" {
			t.Fatalf("expected explicit message, got %q", got)
		}

		if got := (&ControlError{Err: errors.New("wrapped")}).Error(); got != "wrapped" {
			t.Fatalf("expected wrapped error message, got %q", got)
		}

		if got := (&ControlError{Kind: ErrConflict}).Error(); got != ErrConflict.Error() {
			t.Fatalf("expected kind message, got %q", got)
		}

		if got := (&ControlError{}).Error(); got != "control error" {
			t.Fatalf("expected generic fallback, got %q", got)
		}
	})

	t.Run("unwrap and is", func(t *testing.T) {
		var nilErr *ControlError
		if nilErr.Unwrap() != nil {
			t.Fatal("expected nil unwrap for nil receiver")
		}
		if nilErr.Is(ErrValidation) {
			t.Fatal("expected nil receiver Is to be false")
		}

		base := errors.New("base")
		err := &ControlError{Kind: ErrValidation, Err: base}
		if !errors.Is(err, ErrValidation) {
			t.Fatal("expected validation kind match")
		}
		if !errors.Is(err, base) {
			t.Fatal("expected wrapped error match")
		}
	})

	t.Run("constructor helpers", func(t *testing.T) {
		if err := newControlError(ErrValidation, "", nil); err != nil {
			t.Fatalf("expected nil control error when no message or cause, got %v", err)
		}

		err := ValidationError("field x is invalid")
		if !isValidationError(err) || err.Error() != "field x is invalid" {
			t.Fatalf("unexpected ValidationError result: %v", err)
		}

		notFound := NotFoundError("missing row")
		if !isNotFoundError(notFound) {
			t.Fatalf("unexpected NotFoundError result: %v", notFound)
		}

		conflict := ConflictError("duplicate key")
		if !isConflictError(conflict) {
			t.Fatalf("unexpected ConflictError result: %v", conflict)
		}

		unavailableCause := errors.New("db offline")
		unavailable := UnavailableError("write failed", unavailableCause)
		if !errors.Is(unavailable, ErrUnavailable) {
			t.Fatalf("expected unavailable sentinel, got %v", unavailable)
		}
		if got := unavailable.Error(); got != "write failed" {
			t.Fatalf("expected unavailable message, got %q", got)
		}
		if !errors.Is(unavailable, unavailableCause) {
			t.Fatalf("expected wrapped unavailable cause, got %v", unavailable)
		}
	})
}
