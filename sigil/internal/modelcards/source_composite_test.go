package modelcards

import (
	"context"
	"errors"
	"testing"
	"time"
)

type staticSource struct {
	name  string
	cards []Card
	err   error
}

func (s *staticSource) Name() string                                { return s.name }
func (s *staticSource) Fetch(_ context.Context) ([]Card, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.cards, nil
}

func TestCompositeSourceMergesPrimaryAndSecondary(t *testing.T) {
	now := time.Now().UTC()

	primary := &staticSource{
		name: "openrouter",
		cards: []Card{
			{ModelKey: "openrouter:anthropic/claude-3", Source: SourceOpenRouter, Name: "Claude 3", FirstSeenAt: now, LastSeenAt: now, RefreshedAt: now},
			{ModelKey: "openrouter:openai/gpt-4o", Source: SourceOpenRouter, Name: "GPT-4o", FirstSeenAt: now, LastSeenAt: now, RefreshedAt: now},
		},
	}
	secondary := &staticSource{
		name: "bedrock",
		cards: []Card{
			{ModelKey: "bedrock:anthropic.claude-3-haiku-v1:0", Source: SourceBedrock, Name: "Claude 3 Haiku", FirstSeenAt: now, LastSeenAt: now, RefreshedAt: now},
		},
	}

	composite := NewCompositeSource(primary, []Source{secondary}, nil)

	if composite.Name() != "openrouter" {
		t.Fatalf("expected name %q, got %q", "openrouter", composite.Name())
	}

	cards, err := composite.Fetch(context.Background())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}

	if len(cards) != 3 {
		t.Fatalf("expected 3 cards, got %d", len(cards))
	}

	// Cards should be sorted by model_key.
	expectedOrder := []string{
		"bedrock:anthropic.claude-3-haiku-v1:0",
		"openrouter:anthropic/claude-3",
		"openrouter:openai/gpt-4o",
	}
	for i, key := range expectedOrder {
		if cards[i].ModelKey != key {
			t.Errorf("card[%d] = %q, want %q", i, cards[i].ModelKey, key)
		}
	}
}

func TestCompositeSourcePrimaryFailure(t *testing.T) {
	primary := &staticSource{
		name: "openrouter",
		err:  errors.New("openrouter down"),
	}
	secondary := &staticSource{
		name:  "bedrock",
		cards: []Card{{ModelKey: "bedrock:test-model", Source: SourceBedrock}},
	}

	composite := NewCompositeSource(primary, []Source{secondary}, nil)

	_, err := composite.Fetch(context.Background())
	if err == nil {
		t.Fatal("expected error when primary fails, got nil")
	}
}

func TestCompositeSourceSecondaryFailure(t *testing.T) {
	now := time.Now().UTC()

	primary := &staticSource{
		name: "openrouter",
		cards: []Card{
			{ModelKey: "openrouter:test/model", Source: SourceOpenRouter, FirstSeenAt: now, LastSeenAt: now, RefreshedAt: now},
		},
	}
	secondary := &staticSource{
		name: "bedrock",
		err:  errors.New("access denied"),
	}

	composite := NewCompositeSource(primary, []Source{secondary}, nil)

	cards, err := composite.Fetch(context.Background())
	if err != nil {
		t.Fatalf("fetch should succeed despite secondary failure: %v", err)
	}
	if len(cards) != 1 {
		t.Fatalf("expected 1 card from primary, got %d", len(cards))
	}
}

func TestCompositeSourceNoSecondary(t *testing.T) {
	now := time.Now().UTC()

	primary := &staticSource{
		name: "openrouter",
		cards: []Card{
			{ModelKey: "openrouter:test/model", Source: SourceOpenRouter, FirstSeenAt: now, LastSeenAt: now, RefreshedAt: now},
		},
	}

	composite := NewCompositeSource(primary, nil, nil)

	cards, err := composite.Fetch(context.Background())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
}
