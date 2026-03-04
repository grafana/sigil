package mysql

import "testing"

func TestEscapeLikePattern(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"simple", "simple"},
		{"test_agent", `test\_agent`},
		{"foo%bar", `foo\%bar`},
		{`back\slash`, `back\\slash`},
		{"_%combo%_", `\_\%combo\%\_`},
		{"", ""},
	}
	for _, tc := range tests {
		got := escapeLikePattern(tc.input)
		if got != tc.want {
			t.Errorf("escapeLikePattern(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
