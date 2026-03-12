package storage

import (
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestGenerationTimestamp(t *testing.T) {
	t.Run("returns zero time for nil generation", func(t *testing.T) {
		if got := GenerationTimestamp(nil); !got.IsZero() {
			t.Fatalf("expected zero time, got %v", got)
		}
	})

	t.Run("prefers completed time when present", func(t *testing.T) {
		startedAt := time.Date(2026, time.March, 9, 12, 0, 0, 0, time.UTC)
		completedAt := startedAt.Add(2 * time.Minute)

		got := GenerationTimestamp(&sigilv1.Generation{
			StartedAt:   timestamppb.New(startedAt),
			CompletedAt: timestamppb.New(completedAt),
		})

		if !got.Equal(completedAt) {
			t.Fatalf("expected %v, got %v", completedAt, got)
		}
	})

	t.Run("falls back to started time", func(t *testing.T) {
		startedAt := time.Date(2026, time.March, 9, 12, 0, 0, 0, time.UTC)

		got := GenerationTimestamp(&sigilv1.Generation{
			StartedAt: timestamppb.New(startedAt),
		})

		if !got.Equal(startedAt) {
			t.Fatalf("expected %v, got %v", startedAt, got)
		}
	})
}
