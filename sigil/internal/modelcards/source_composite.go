package modelcards

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
)

// CompositeSource fetches from a primary source and zero or more secondary
// sources, merging all results. Secondary source failures are logged but do
// not fail the overall fetch — only the primary source is required.
type CompositeSource struct {
	primary   Source
	secondary []Source
	logger    *slog.Logger
}

func NewCompositeSource(primary Source, secondary []Source, logger *slog.Logger) *CompositeSource {
	if logger == nil {
		logger = slog.Default()
	}
	return &CompositeSource{
		primary:   primary,
		secondary: secondary,
		logger:    logger,
	}
}

func (c *CompositeSource) Name() string {
	return c.primary.Name()
}

func (c *CompositeSource) Fetch(ctx context.Context) ([]Card, error) {
	cards, err := c.primary.Fetch(ctx)
	if err != nil {
		return nil, fmt.Errorf("primary source %s: %w", c.primary.Name(), err)
	}

	for _, src := range c.secondary {
		extra, fetchErr := src.Fetch(ctx)
		if fetchErr != nil {
			c.logger.Warn("secondary catalog source fetch failed",
				"source", src.Name(),
				"err", fetchErr,
			)
			continue
		}
		c.logger.Info("secondary catalog source fetched",
			"source", src.Name(),
			"count", len(extra),
		)
		cards = append(cards, extra...)
	}

	sort.Slice(cards, func(i, j int) bool {
		return cards[i].ModelKey < cards[j].ModelKey
	})

	return cards, nil
}
