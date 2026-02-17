package modelcards

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type staticCardsSource struct {
	cards []Card
}

func (s *staticCardsSource) Name() string {
	return SourceOpenRouter
}

func (s *staticCardsSource) Fetch(_ context.Context) ([]Card, error) {
	return s.cards, nil
}

func TestListSnapshotFallbackIncludesSupplementalCatalog(t *testing.T) {
	now := time.Now().UTC()
	snapshot := SnapshotFromCards(SourceOpenRouter, now, []Card{
		{
			ModelKey:      "openrouter:openai/gpt-4o",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-4o",
			Name:          "GPT-4o",
			Provider:      "openai",
		},
	})

	patchedName := "GPT-4o Patched"
	supplemental := &SupplementalCatalog{
		Models: []SupplementalModel{
			{
				ModelKey:      "supplemental:anthropic/claude-opus-4-6-v1",
				SourceModelID: "anthropic/claude-opus-4-6-v1",
				Name:          "Claude Opus 4.6 v1",
				Provider:      "anthropic",
			},
		},
		Patches: []SupplementalPatch{
			{
				TargetSourceModelID: "openai/gpt-4o",
				Name:                &patchedName,
			},
		},
	}

	svc := NewServiceWithSupplemental(
		NewMemoryStore(),
		NewStaticErrorSource(errors.New("disabled")),
		&snapshot,
		supplemental,
		Config{
			SyncInterval:  30 * time.Minute,
			LeaseTTL:      2 * time.Minute,
			SourceTimeout: 2 * time.Second,
			StaleSoft:     2 * time.Hour,
			StaleHard:     24 * time.Hour,
			BootstrapMode: BootstrapModeSnapshotFirst,
			OwnerID:       "supplemental-list-test",
		},
		nil,
	)

	result, err := svc.List(context.Background(), ListParams{Limit: 20})
	if err != nil {
		t.Fatalf("list snapshot fallback: %v", err)
	}
	if result.Freshness.SourcePath != SourcePathSnapshotFallback {
		t.Fatalf("expected snapshot fallback source path, got %q", result.Freshness.SourcePath)
	}
	if len(result.Data) != 2 {
		t.Fatalf("expected two cards after supplemental merge, got %d", len(result.Data))
	}

	foundPatched := false
	foundSupplemental := false
	for _, card := range result.Data {
		switch card.SourceModelID {
		case "openai/gpt-4o":
			foundPatched = true
			if card.Name != patchedName {
				t.Fatalf("expected patched name %q, got %q", patchedName, card.Name)
			}
		case "anthropic/claude-opus-4-6-v1":
			foundSupplemental = true
			if card.Source != SourceSupplemental {
				t.Fatalf("expected supplemental source %q, got %q", SourceSupplemental, card.Source)
			}
		}
	}
	if !foundPatched {
		t.Fatalf("patched base card not returned")
	}
	if !foundSupplemental {
		t.Fatalf("supplemental card not returned")
	}
}

func TestRefreshNowPrimaryMergesSupplementalCards(t *testing.T) {
	now := time.Now().UTC()
	store := NewMemoryStore()
	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	svc := NewServiceWithSupplemental(
		store,
		&staticCardsSource{
			cards: []Card{
				{
					ModelKey:      "openrouter:openai/gpt-4o",
					Source:        SourceOpenRouter,
					SourceModelID: "openai/gpt-4o",
					Name:          "GPT-4o",
				},
			},
		},
		nil,
		&SupplementalCatalog{
			Models: []SupplementalModel{
				{
					ModelKey:      "supplemental:anthropic/claude-opus-4-6-v1",
					SourceModelID: "anthropic/claude-opus-4-6-v1",
					Name:          "Claude Opus 4.6 v1",
				},
			},
		},
		Config{
			SyncInterval:  30 * time.Minute,
			LeaseTTL:      2 * time.Minute,
			SourceTimeout: 2 * time.Second,
			StaleSoft:     24 * time.Hour,
			StaleHard:     48 * time.Hour,
			BootstrapMode: BootstrapModeDBOnly,
			OwnerID:       "supplemental-refresh-test",
		},
		nil,
	)
	svc.now = func() time.Time { return now }

	run, err := svc.RefreshNow(context.Background(), "primary")
	if err != nil {
		t.Fatalf("refresh now: %v", err)
	}
	if run.Status != "success" {
		t.Fatalf("expected success refresh run, got %q", run.Status)
	}
	if run.FetchedCount != 2 {
		t.Fatalf("expected fetched_count=2 after supplemental merge, got %d", run.FetchedCount)
	}

	result, err := svc.List(context.Background(), ListParams{Limit: 10})
	if err != nil {
		t.Fatalf("list after refresh: %v", err)
	}
	if len(result.Data) != 2 {
		t.Fatalf("expected two cards in store, got %d", len(result.Data))
	}

	foundSupplemental := false
	for _, card := range result.Data {
		if card.SourceModelID == "anthropic/claude-opus-4-6-v1" {
			foundSupplemental = true
			if card.Source != SourceSupplemental {
				t.Fatalf("expected supplemental source %q, got %q", SourceSupplemental, card.Source)
			}
		}
	}
	if !foundSupplemental {
		t.Fatalf("supplemental card missing after refresh")
	}
}

func TestRefreshNowFailsOnInvalidSupplementalMerge(t *testing.T) {
	store := NewMemoryStore()
	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	svc := NewServiceWithSupplemental(
		store,
		&staticCardsSource{
			cards: []Card{
				{
					ModelKey:      "openrouter:openai/gpt-4o",
					Source:        SourceOpenRouter,
					SourceModelID: "openai/gpt-4o",
					Name:          "GPT-4o",
				},
			},
		},
		nil,
		&SupplementalCatalog{
			Patches: []SupplementalPatch{
				{
					TargetSourceModelID: "openai/missing-model",
					Name:                stringPtr("Missing Target"),
				},
			},
		},
		Config{
			SyncInterval:  30 * time.Minute,
			LeaseTTL:      2 * time.Minute,
			SourceTimeout: 2 * time.Second,
			StaleSoft:     24 * time.Hour,
			StaleHard:     48 * time.Hour,
			BootstrapMode: BootstrapModeDBOnly,
			OwnerID:       "supplemental-refresh-failure-test",
		},
		nil,
	)

	run, err := svc.RefreshNow(context.Background(), "primary")
	if err == nil {
		t.Fatalf("expected refresh to fail on supplemental conflict")
	}
	if run.Status != "failed" {
		t.Fatalf("expected failed refresh run status, got %q", run.Status)
	}
	if !strings.Contains(run.ErrorSummary, "patch target not found") {
		t.Fatalf("expected supplemental patch target error, got %q", run.ErrorSummary)
	}
}

func stringPtr(value string) *string {
	return &value
}
