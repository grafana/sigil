package mysql

import (
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/modelcards"
)

func TestToModelCardModelPrefersCardSource(t *testing.T) {
	now := time.Now().UTC()
	row := toModelCardModel(
		modelcards.Card{
			ModelKey:      "supplemental:anthropic/claude-opus-4-6-v1",
			Source:        modelcards.SourceSupplemental,
			SourceModelID: "anthropic/claude-opus-4-6-v1",
			Name:          "Claude Opus 4.6 v1",
		},
		modelcards.SourceOpenRouter,
		now,
	)

	if row.Source != modelcards.SourceSupplemental {
		t.Fatalf("expected row source %q, got %q", modelcards.SourceSupplemental, row.Source)
	}
}

func TestToModelCardModelFallsBackToUpsertSource(t *testing.T) {
	now := time.Now().UTC()
	row := toModelCardModel(
		modelcards.Card{
			ModelKey:      "openrouter:openai/gpt-4o",
			SourceModelID: "openai/gpt-4o",
			Name:          "GPT-4o",
		},
		modelcards.SourceOpenRouter,
		now,
	)

	if row.Source != modelcards.SourceOpenRouter {
		t.Fatalf("expected fallback source %q, got %q", modelcards.SourceOpenRouter, row.Source)
	}
}
