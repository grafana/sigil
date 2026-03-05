package jsonutil

import (
	"encoding/json"
	"errors"
	"io"
)

// EnsureEOF verifies that the decoder has consumed all JSON values. It returns
// an error if additional tokens remain in the stream.
func EnsureEOF(decoder *json.Decoder) error {
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("unexpected trailing JSON data")
		}
		return err
	}
	return nil
}
