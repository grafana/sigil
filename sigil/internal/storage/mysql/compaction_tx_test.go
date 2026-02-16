package mysql

import (
	"slices"
	"testing"
)

func TestSortedUniqueIDs(t *testing.T) {
	input := []uint64{9, 4, 9, 1, 7, 1, 3}
	original := append([]uint64(nil), input...)

	got := sortedUniqueIDs(input)
	want := []uint64{1, 3, 4, 7, 9}

	if !slices.Equal(got, want) {
		t.Fatalf("sortedUniqueIDs(%v)=%v, want %v", input, got, want)
	}
	if !slices.Equal(input, original) {
		t.Fatalf("sortedUniqueIDs should not mutate input, got %v want %v", input, original)
	}
}
