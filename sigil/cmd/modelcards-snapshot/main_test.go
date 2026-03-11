package main

import "testing"

func TestSnapshotOutputPath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "uses explicit path",
			input: " ./tmp/snapshot.json ",
			want:  "./tmp/snapshot.json",
		},
		{
			name:  "falls back to default for blank input",
			input: "   ",
			want:  defaultSnapshotOutputPath,
		},
		{
			name:  "falls back to default for empty input",
			input: "",
			want:  defaultSnapshotOutputPath,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := snapshotOutputPath(tc.input)
			if got != tc.want {
				t.Fatalf("snapshotOutputPath(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}
