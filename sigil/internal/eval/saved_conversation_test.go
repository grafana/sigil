package eval

import "testing"

func TestSavedConversationSourceValidation(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name   string
		input  string
		want   SavedConversationSource
		wantOK bool
	}{
		{name: "telemetry", input: "telemetry", want: SavedConversationSourceTelemetry, wantOK: true},
		{name: "manual", input: "manual", want: SavedConversationSourceManual, wantOK: true},
		{name: "whitespace trimmed", input: " telemetry ", want: SavedConversationSourceTelemetry, wantOK: true},
		{name: "invalid", input: "unknown", want: "", wantOK: false},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, ok := ParseSavedConversationSource(tc.input)
			if ok != tc.wantOK {
				t.Fatalf("ParseSavedConversationSource(%q) ok=%t, want %t", tc.input, ok, tc.wantOK)
			}
			if got != tc.want {
				t.Fatalf("ParseSavedConversationSource(%q) = %q, want %q", tc.input, got, tc.want)
			}
			if IsValidSavedConversationSource(tc.input) != tc.wantOK {
				t.Fatalf("IsValidSavedConversationSource(%q) mismatch", tc.input)
			}
		})
	}
}
