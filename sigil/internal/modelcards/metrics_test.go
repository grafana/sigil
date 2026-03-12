package modelcards

import "testing"

func TestNormalizeMetricLabel(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name     string
		input    string
		fallback string
		want     string
	}{
		{
			name:     "keeps explicit value",
			input:    "primary",
			fallback: "unknown",
			want:     "primary",
		},
		{
			name:     "trims surrounding whitespace",
			input:    "  openrouter  ",
			fallback: "unknown",
			want:     "openrouter",
		},
		{
			name:     "uses fallback for empty",
			input:    "",
			fallback: "unknown",
			want:     "unknown",
		},
		{
			name:     "uses fallback for whitespace only",
			input:    " \t ",
			fallback: SourceOpenRouter,
			want:     SourceOpenRouter,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := normalizeMetricLabel(tc.input, tc.fallback); got != tc.want {
				t.Fatalf("normalizeMetricLabel(%q, %q) = %q, want %q", tc.input, tc.fallback, got, tc.want)
			}
		})
	}
}
