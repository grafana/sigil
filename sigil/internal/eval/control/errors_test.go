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

		err := ValidationErrorf("field %s is invalid", "x")
		if !isValidationError(err) || err.Error() != "field x is invalid" {
			t.Fatalf("unexpected ValidationErrorf result: %v", err)
		}

		notFoundCause := errors.New("missing row")
		notFound := NotFoundWrap(notFoundCause)
		if !isNotFoundError(notFound) || !errors.Is(notFound, notFoundCause) {
			t.Fatalf("unexpected NotFoundWrap result: %v", notFound)
		}

		conflictCause := errors.New("duplicate key")
		conflict := ConflictWrap(conflictCause)
		if !isConflictError(conflict) || !errors.Is(conflict, conflictCause) {
			t.Fatalf("unexpected ConflictWrap result: %v", conflict)
		}

		internalCause := errors.New("db offline")
		internal := InternalError("write failed", internalCause)
		if !errors.Is(internal, ErrInternal) {
			t.Fatalf("expected internal sentinel, got %v", internal)
		}
		if got := internal.Error(); got != "write failed" {
			t.Fatalf("expected internal message, got %q", got)
		}
		if !errors.Is(internal, internalCause) {
			t.Fatalf("expected wrapped internal cause, got %v", internal)
		}
	})
}
