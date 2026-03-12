package storage

import (
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

// GenerationTimestamp returns the best available generation event time for ordering.
func GenerationTimestamp(generation *sigilv1.Generation) time.Time {
	if generation == nil {
		return time.Time{}
	}
	if completedAt := generation.GetCompletedAt(); completedAt != nil {
		return completedAt.AsTime().UTC()
	}
	if startedAt := generation.GetStartedAt(); startedAt != nil {
		return startedAt.AsTime().UTC()
	}
	return time.Time{}
}
