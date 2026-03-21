package control

import (
	"errors"
	"strings"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

var (
	ErrValidation   = errors.New("validation")
	ErrUnauthorized = errors.New("unauthorized")
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("conflict")
	ErrUnavailable  = errors.New("unavailable")
)

type FieldError struct {
	Field   string
	Message string
}

type ControlError struct {
	Kind    error
	Message string
	Fields  []FieldError
	Err     error
}

func (e *ControlError) Error() string {
	if e == nil {
		return ""
	}
	switch {
	case strings.TrimSpace(e.Message) != "":
		return e.Message
	case e.Err != nil:
		return e.Err.Error()
	case e.Kind != nil:
		return e.Kind.Error()
	default:
		return "control error"
	}
}

func (e *ControlError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *ControlError) Is(target error) bool {
	if e == nil || e.Kind == nil {
		return false
	}
	return target == e.Kind
}

func newControlError(kind error, message string, err error, fields ...FieldError) error {
	if err == nil && strings.TrimSpace(message) == "" {
		return nil
	}
	if message == "" && err != nil {
		message = err.Error()
	}
	return &ControlError{
		Kind:    kind,
		Message: message,
		Fields:  append([]FieldError(nil), fields...),
		Err:     err,
	}
}

func ValidationError(message string, fields ...FieldError) error {
	return newControlError(ErrValidation, message, nil, fields...)
}

func ValidationWrap(err error, fields ...FieldError) error {
	if err == nil {
		return nil
	}
	return newControlError(ErrValidation, "", err, fields...)
}

func UnauthorizedError(message string) error {
	return newControlError(ErrUnauthorized, message, nil)
}

func NotFoundError(message string) error {
	return newControlError(ErrNotFound, message, nil)
}

func ConflictError(message string) error {
	return newControlError(ErrConflict, message, nil)
}

func UnavailableError(message string, err error) error {
	return newControlError(ErrUnavailable, message, err)
}

func isValidationError(err error) bool {
	return errors.Is(err, ErrValidation)
}

func isUnauthorizedError(err error) bool {
	return errors.Is(err, ErrUnauthorized)
}

func isNotFoundError(err error) bool {
	return errors.Is(err, ErrNotFound) || errors.Is(err, evalpkg.ErrNotFound)
}

func isConflictError(err error) bool {
	return errors.Is(err, ErrConflict) || errors.Is(err, evalpkg.ErrConflict)
}

func isUnavailableError(err error) bool {
	return errors.Is(err, ErrUnavailable)
}
