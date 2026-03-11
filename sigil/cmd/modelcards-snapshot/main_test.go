package main

import "testing"

func TestSnapshotOutputPath(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "defaults when empty",
			input: "",
			want:  defaultSnapshotOutputPath,
		},
		{
			name:  "defaults when whitespace",
			input: " \t\n ",
			want:  defaultSnapshotOutputPath,
		},
		{
			name:  "trims provided path",
			input: "  ./tmp/snapshot.json  ",
			want:  "./tmp/snapshot.json",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := snapshotOutputPath(tt.input); got != tt.want {
				t.Fatalf("snapshotOutputPath(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
