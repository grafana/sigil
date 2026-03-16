package worker

import "testing"

func TestBoolLabel(t *testing.T) {
	t.Parallel()

	trueValue := true
	falseValue := false

	testCases := []struct {
		name  string
		input *bool
		want  string
	}{
		{
			name:  "nil defaults unknown",
			input: nil,
			want:  workerUnknownLabel,
		},
		{
			name:  "true maps to true",
			input: &trueValue,
			want:  "true",
		},
		{
			name:  "false maps to false",
			input: &falseValue,
			want:  "false",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := boolLabel(tc.input); got != tc.want {
				t.Fatalf("boolLabel(%v) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}
