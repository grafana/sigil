package jsonutil

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEnsureEOF(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{name: "empty after value", input: `{"a":1}`, wantErr: ""},
		{name: "trailing whitespace only", input: `{"a":1}   `, wantErr: ""},
		{name: "trailing json object", input: `{"a":1}{"b":2}`, wantErr: "unexpected trailing JSON data"},
		{name: "trailing json number", input: `{"a":1} 42`, wantErr: "unexpected trailing JSON data"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			decoder := json.NewDecoder(strings.NewReader(tt.input))
			var discard json.RawMessage
			if err := decoder.Decode(&discard); err != nil {
				t.Fatalf("setup decode failed: %v", err)
			}

			err := EnsureEOF(decoder)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("expected error containing %q, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
