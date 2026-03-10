package eval

import "testing"

func TestNormalizeActorID(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantOut string
	}{
		{
			name:    "uses legacy id for empty string",
			input:   "",
			wantOut: LegacyActorID,
		},
		{
			name:    "uses legacy id for whitespace only",
			input:   "   ",
			wantOut: LegacyActorID,
		},
		{
			name:    "trims surrounding whitespace",
			input:   "  alice@example.com  ",
			wantOut: "alice@example.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeActorID(tt.input); got != tt.wantOut {
				t.Fatalf("NormalizeActorID(%q) = %q, want %q", tt.input, got, tt.wantOut)
			}
		})
	}
}
