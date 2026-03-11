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
			name:  "uses default when empty",
			input: "",
			want:  defaultSnapshotOutputPath,
		},
		{
			name:  "uses default when whitespace only",
			input: "   \n\t ",
			want:  defaultSnapshotOutputPath,
		},
		{
			name:  "trims and returns custom path",
			input: " ./tmp/snapshot.json ",
			want:  "./tmp/snapshot.json",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := snapshotOutputPath(tt.input); got != tt.want {
				t.Fatalf("snapshotOutputPath(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
