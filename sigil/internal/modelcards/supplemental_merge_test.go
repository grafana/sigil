package modelcards

import (
	"strings"
	"testing"
	"time"
)

func TestMergeSupplementalCardsAddsAndPatches(t *testing.T) {
	now := time.Now().UTC()
	base := []Card{
		{
			ModelKey:      "openrouter:openai/gpt-4o",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-4o",
			Name:          "GPT-4o",
			Provider:      "openai",
		},
	}

	updatedName := "GPT-4o Patched"
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
				Name:                &updatedName,
			},
		},
	}

	merged, err := MergeSupplementalCards(base, now, supplemental)
	if err != nil {
		t.Fatalf("merge supplemental cards: %v", err)
	}
	if len(merged) != 2 {
		t.Fatalf("expected 2 cards after merge, got %d", len(merged))
	}

	foundPatched := false
	foundSupplemental := false
	for _, card := range merged {
		switch card.SourceModelID {
		case "openai/gpt-4o":
			foundPatched = true
			if card.Name != updatedName {
				t.Fatalf("expected patched name %q, got %q", updatedName, card.Name)
			}
		case "anthropic/claude-opus-4-6-v1":
			foundSupplemental = true
			if card.Source != SourceSupplemental {
				t.Fatalf("expected supplemental source %q, got %q", SourceSupplemental, card.Source)
			}
		}
	}
	if !foundPatched {
		t.Fatalf("patched base model was not found in merged output")
	}
	if !foundSupplemental {
		t.Fatalf("supplemental model was not found in merged output")
	}
}

func TestMergeSupplementalCardsSkipsDuplicateSourceModelIDAcrossSources(t *testing.T) {
	now := time.Now().UTC()
	base := []Card{
		{
			ModelKey:      "openrouter:openai/gpt-4o",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-4o",
			Name:          "GPT-4o",
		},
	}
	supplemental := &SupplementalCatalog{
		Models: []SupplementalModel{
			{
				ModelKey:      "supplemental:openai/gpt-4o",
				SourceModelID: "openai/gpt-4o",
				Name:          "Duplicate GPT-4o",
			},
		},
	}

	merged, err := MergeSupplementalCards(base, now, supplemental)
	if err != nil {
		t.Fatalf("merge supplemental cards: %v", err)
	}
	if len(merged) != 1 {
		t.Fatalf("expected duplicate supplemental model to be ignored, got %d cards", len(merged))
	}
	if merged[0].ModelKey != "openrouter:openai/gpt-4o" {
		t.Fatalf("expected base card to remain authoritative, got %q", merged[0].ModelKey)
	}
}

func TestValidateSupplementalAgainstSnapshotMissingPatchTarget(t *testing.T) {
	now := time.Now().UTC()
	snapshot := SnapshotFromCards(SourceOpenRouter, now, []Card{
		{
			ModelKey:      "openrouter:openai/gpt-4o",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-4o",
			Name:          "GPT-4o",
		},
	})
	namePatch := "Other"
	supplemental := &SupplementalCatalog{
		Patches: []SupplementalPatch{
			{
				TargetSourceModelID: "openai/missing",
				Name:                &namePatch,
			},
		},
	}

	err := ValidateSupplementalAgainstSnapshot(snapshot, supplemental)
	if err == nil {
		t.Fatalf("expected missing patch target error")
	}
	if !strings.Contains(err.Error(), "patch target not found") {
		t.Fatalf("expected patch target not found error, got %v", err)
	}
}
