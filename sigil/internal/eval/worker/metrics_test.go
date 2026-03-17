package worker

import "testing"

func TestTruncateLabel(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name   string
		input  string
		maxLen int
		want   string
	}{
		{
			name:   "short string unchanged",
			input:  "hello",
			maxLen: 64,
			want:   "hello",
		},
		{
			name:   "exact length unchanged",
			input:  "hello",
			maxLen: 5,
			want:   "hello",
		},
		{
			name:   "ascii truncation",
			input:  "hello world",
			maxLen: 5,
			want:   "hello",
		},
		{
			name:   "multi-byte char not split (2-byte)",
			input:  "helloé", // 'é' is 2 bytes (0xC3 0xA9)
			maxLen: 6,        // "hello" = 5 bytes, need 7 to include 'é'
			want:   "hello",  // truncate before splitting 'é'
		},
		{
			name:   "multi-byte char included when fits",
			input:  "helloé",
			maxLen: 7,
			want:   "helloé",
		},
		{
			name:   "emoji not split (4-byte)",
			input:  "test😀", // emoji is 4 bytes
			maxLen: 5,       // "test" = 4 bytes, need 8 to include emoji
			want:   "test",
		},
		{
			name:   "emoji included when fits",
			input:  "test😀",
			maxLen: 8,
			want:   "test😀",
		},
		{
			name:   "cjk not split (3-byte)",
			input:  "abc中", // '中' is 3 bytes
			maxLen: 4,      // "abc" = 3 bytes, need 6 to include '中'
			want:   "abc",
		},
		{
			name:   "cjk included when fits",
			input:  "abc中",
			maxLen: 6,
			want:   "abc中",
		},
		{
			name:   "empty string unchanged",
			input:  "",
			maxLen: 10,
			want:   "",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := truncateLabel(tc.input, tc.maxLen)
			if got != tc.want {
				t.Fatalf("truncateLabel(%q, %d) = %q, want %q", tc.input, tc.maxLen, got, tc.want)
			}
			if len(got) > tc.maxLen {
				t.Fatalf("truncateLabel(%q, %d) result length %d exceeds max %d", tc.input, tc.maxLen, len(got), tc.maxLen)
			}
		})
	}
}

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
