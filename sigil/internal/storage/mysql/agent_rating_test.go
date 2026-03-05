package mysql

import (
	"context"
	"testing"

	"github.com/grafana/sigil/sigil/internal/agentrating"
)

func TestAgentVersionRatingUpsertAndLookup(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	first := agentrating.Rating{
		Status:  agentrating.RatingStatusPending,
		Score:   6,
		Summary: "Baseline is acceptable but has tool ambiguity.",
		Suggestions: []agentrating.Suggestion{
			{
				Category:    "tools",
				Severity:    "medium",
				Title:       "Clarify tool intent",
				Description: "Tighten each tool description and expected output contract.",
			},
		},
		TokenWarning:   "Estimated baseline context is high.",
		JudgeModel:     "openai/gpt-4o-mini",
		JudgeLatencyMs: 120,
	}

	if err := store.UpsertAgentVersionRating(
		context.Background(),
		"tenant-a",
		"assistant",
		"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		first,
	); err != nil {
		t.Fatalf("upsert first rating: %v", err)
	}

	got, err := store.GetAgentVersionRating(
		context.Background(),
		"tenant-a",
		"assistant",
		"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	)
	if err != nil {
		t.Fatalf("get persisted rating: %v", err)
	}
	if got == nil {
		t.Fatalf("expected persisted rating")
	}
	if got.Score != first.Score {
		t.Fatalf("expected score=%d, got=%d", first.Score, got.Score)
	}
	if got.Summary != first.Summary {
		t.Fatalf("expected summary=%q, got=%q", first.Summary, got.Summary)
	}
	if got.Status != first.Status {
		t.Fatalf("expected status=%q, got=%q", first.Status, got.Status)
	}
	if len(got.Suggestions) != 1 {
		t.Fatalf("expected one suggestion, got=%d", len(got.Suggestions))
	}
	if got.JudgeModel != first.JudgeModel {
		t.Fatalf("expected judge model=%q, got=%q", first.JudgeModel, got.JudgeModel)
	}

	second := agentrating.Rating{
		Score:   9,
		Summary: "Excellent structure and clear contracts.",
		Suggestions: []agentrating.Suggestion{
			{
				Category:    "system_prompt",
				Severity:    "low",
				Title:       "Add one edge-case example",
				Description: "A short negative example would make fallback behavior clearer.",
			},
		},
		JudgeModel:     "anthropic/claude-sonnet-4-5",
		JudgeLatencyMs: 220,
	}

	if err := store.UpsertAgentVersionRating(
		context.Background(),
		"tenant-a",
		"assistant",
		"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		second,
	); err != nil {
		t.Fatalf("upsert second rating: %v", err)
	}

	updated, err := store.GetAgentVersionRating(
		context.Background(),
		"tenant-a",
		"assistant",
		"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	)
	if err != nil {
		t.Fatalf("get updated rating: %v", err)
	}
	if updated == nil {
		t.Fatalf("expected updated rating")
	}
	if updated.Score != second.Score {
		t.Fatalf("expected score=%d, got=%d", second.Score, updated.Score)
	}
	if updated.Summary != second.Summary {
		t.Fatalf("expected summary=%q, got=%q", second.Summary, updated.Summary)
	}
	if updated.Status != agentrating.RatingStatusCompleted {
		t.Fatalf("expected status=%q, got=%q", agentrating.RatingStatusCompleted, updated.Status)
	}
	if updated.JudgeModel != second.JudgeModel {
		t.Fatalf("expected judge model=%q, got=%q", second.JudgeModel, updated.JudgeModel)
	}
	if len(updated.Suggestions) != 1 || updated.Suggestions[0].Title != second.Suggestions[0].Title {
		t.Fatalf("expected updated suggestions, got=%+v", updated.Suggestions)
	}
}

func TestGetAgentVersionRatingReturnsNilWhenMissing(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()

	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	got, err := store.GetAgentVersionRating(
		context.Background(),
		"tenant-a",
		"assistant",
		"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	)
	if err != nil {
		t.Fatalf("get missing rating: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil rating for missing row, got=%+v", got)
	}
}
