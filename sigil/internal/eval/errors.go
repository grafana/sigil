package eval

import "errors"

var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("conflict")

type permanentError struct {
	err error
}

func (e permanentError) Error() string {
	if e.err == nil {
		return "permanent error"
	}
	return e.err.Error()
}

func (e permanentError) Unwrap() error {
	return e.err
}

func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return permanentError{err: err}
}

func IsPermanent(err error) bool {
	var marker permanentError
	return errors.As(err, &marker)
}
