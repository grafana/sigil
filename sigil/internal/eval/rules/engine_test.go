package rules

import (
	"context"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/proto"
)

func TestEngineOnGenerationsSavedEnqueuesMatchingWorkItems(t *testing.T) {
	generation := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		AgentName:      "assistant-main",
		Output: []*sigilv1.Message{{
			Role:  sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hello"}}},
		}},
	}
	payload, err := proto.Marshal(generation)
	if err != nil {
		t.Fatalf("marshal generation: %v", err)
	}

	store := &engineTestStore{
		rules: []evalpkg.RuleDefinition{
			{
				TenantID:     "tenant-a",
				RuleID:       "rule-1",
				Enabled:      true,
				Selector:     evalpkg.SelectorUserVisibleTurn,
				Match:        map[string]any{"agent_name": []string{"assistant-*"}},
				SampleRate:   1,
				EvaluatorIDs: []string{"sigil.helpfulness", "sigil.conciseness"},
			},
		},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"sigil.helpfulness": {EvaluatorID: "sigil.helpfulness", Version: "2026-02-17", Kind: evalpkg.EvaluatorKindLLMJudge},
			"sigil.conciseness": {EvaluatorID: "sigil.conciseness", Version: "2026-02-17", Kind: evalpkg.EvaluatorKindHeuristic},
		},
	}

	engine := NewEngine(store)
	err = engine.OnGenerationsSaved(context.Background(), "tenant-a", []GenerationRow{{
		GenerationID:   "gen-1",
		ConversationID: strPtr("conv-1"),
		Payload:        payload,
	}})
	if err != nil {
		t.Fatalf("run engine: %v", err)
	}

	if len(store.enqueued) != 2 {
		t.Fatalf("expected 2 enqueued work items, got %d", len(store.enqueued))
	}
	for _, item := range store.enqueued {
		if item.TenantID != "tenant-a" {
			t.Fatalf("unexpected tenant id %q", item.TenantID)
		}
		if item.GenerationID != "gen-1" {
			t.Fatalf("unexpected generation id %q", item.GenerationID)
		}
		if item.RuleID != "rule-1" {
			t.Fatalf("unexpected rule id %q", item.RuleID)
		}
		if item.WorkID == "" {
			t.Fatalf("expected work id")
		}
	}
}

func TestEngineSkipsNonMatchingSelectors(t *testing.T) {
	generation := &sigilv1.Generation{Id: "gen-1"}
	payload, err := proto.Marshal(generation)
	if err != nil {
		t.Fatalf("marshal generation: %v", err)
	}

	store := &engineTestStore{
		rules: []evalpkg.RuleDefinition{
			{
				TenantID:     "tenant-a",
				RuleID:       "rule-1",
				Enabled:      true,
				Selector:     evalpkg.SelectorUserVisibleTurn,
				Match:        map[string]any{},
				SampleRate:   1,
				EvaluatorIDs: []string{"sigil.helpfulness"},
			},
		},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"sigil.helpfulness": {EvaluatorID: "sigil.helpfulness", Version: "2026-02-17", Kind: evalpkg.EvaluatorKindLLMJudge},
		},
	}

	engine := NewEngine(store)
	err = engine.OnGenerationsSaved(context.Background(), "tenant-a", []GenerationRow{{
		GenerationID: "gen-1",
		Payload:      payload,
	}})
	if err != nil {
		t.Fatalf("run engine: %v", err)
	}
	if len(store.enqueued) != 0 {
		t.Fatalf("expected no enqueued items for non-matching selector, got %d", len(store.enqueued))
	}
}

func TestEngineMarksDecodeErrorsPermanent(t *testing.T) {
	store := &engineTestStore{
		rules: []evalpkg.RuleDefinition{
			{
				TenantID:     "tenant-a",
				RuleID:       "rule-1",
				Enabled:      true,
				Selector:     evalpkg.SelectorAllAssistantGenerations,
				Match:        map[string]any{},
				SampleRate:   1,
				EvaluatorIDs: []string{"sigil.helpfulness"},
			},
		},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"sigil.helpfulness": {
				EvaluatorID: "sigil.helpfulness",
				Version:     "2026-02-17",
				Kind:        evalpkg.EvaluatorKindLLMJudge,
			},
		},
	}
	engine := NewEngine(store)

	err := engine.OnGenerationsSaved(context.Background(), "tenant-a", []GenerationRow{{
		GenerationID: "gen-bad",
		Payload:      []byte("not-protobuf"),
	}})
	if err == nil {
		t.Fatalf("expected decode error")
	}
	if !evalpkg.IsPermanent(err) {
		t.Fatalf("expected decode error to be permanent, got %v", err)
	}
}

func TestEngineReturnsErrorWhenRuleReferencesMissingEvaluator(t *testing.T) {
	generation := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		Output: []*sigilv1.Message{{
			Role:  sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hello"}}},
		}},
	}
	payload, err := proto.Marshal(generation)
	if err != nil {
		t.Fatalf("marshal generation: %v", err)
	}

	store := &engineTestStore{
		rules: []evalpkg.RuleDefinition{
			{
				TenantID:     "tenant-a",
				RuleID:       "rule-missing-evaluator",
				Enabled:      true,
				Selector:     evalpkg.SelectorAllAssistantGenerations,
				Match:        map[string]any{},
				SampleRate:   1,
				EvaluatorIDs: []string{"sigil.deleted"},
			},
		},
		evaluators: map[string]evalpkg.EvaluatorDefinition{},
	}
	engine := NewEngine(store)

	err = engine.OnGenerationsSaved(context.Background(), "tenant-a", []GenerationRow{{
		GenerationID:   "gen-1",
		ConversationID: strPtr("conv-1"),
		Payload:        payload,
	}})
	if err == nil {
		t.Fatalf("expected missing evaluator error")
	}
	if !evalpkg.IsPermanent(err) {
		t.Fatalf("expected missing evaluator error to be permanent, got %v", err)
	}
	if err.Error() != `rule "rule-missing-evaluator" references missing evaluator "sigil.deleted"` {
		t.Fatalf("unexpected missing evaluator error: %v", err)
	}
	if len(store.enqueued) != 0 {
		t.Fatalf("expected no enqueued work items when evaluator is missing, got %d", len(store.enqueued))
	}
}

func TestEngineInvalidateTenantCacheForcesReload(t *testing.T) {
	generation := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		Output: []*sigilv1.Message{{
			Role:  sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hello"}}},
		}},
	}
	payload, err := proto.Marshal(generation)
	if err != nil {
		t.Fatalf("marshal generation: %v", err)
	}

	store := &engineTestStore{
		rules: []evalpkg.RuleDefinition{
			{
				TenantID:     "tenant-a",
				RuleID:       "rule-1",
				Enabled:      true,
				Selector:     evalpkg.SelectorAllAssistantGenerations,
				Match:        map[string]any{},
				SampleRate:   1,
				EvaluatorIDs: []string{"sigil.helpfulness"},
			},
		},
		evaluators: map[string]evalpkg.EvaluatorDefinition{
			"sigil.helpfulness": {
				EvaluatorID: "sigil.helpfulness",
				Version:     "2026-02-17",
				Kind:        evalpkg.EvaluatorKindLLMJudge,
			},
		},
	}
	engine := NewEngine(store)
	engine.cacheTTL = time.Minute

	rows := []GenerationRow{{
		GenerationID:   "gen-1",
		ConversationID: strPtr("conv-1"),
		Payload:        payload,
	}}
	if err := engine.OnGenerationsSaved(context.Background(), "tenant-a", rows); err != nil {
		t.Fatalf("first run engine: %v", err)
	}
	if err := engine.OnGenerationsSaved(context.Background(), "tenant-a", rows); err != nil {
		t.Fatalf("second run engine: %v", err)
	}
	if store.listRulesCalls != 1 {
		t.Fatalf("expected cached second run to avoid reload, got list calls=%d", store.listRulesCalls)
	}

	engine.InvalidateTenantCache("tenant-a")
	if err := engine.OnGenerationsSaved(context.Background(), "tenant-a", rows); err != nil {
		t.Fatalf("third run engine after invalidation: %v", err)
	}
	if store.listRulesCalls != 2 {
		t.Fatalf("expected invalidation to force reload, got list calls=%d", store.listRulesCalls)
	}
}

type engineTestStore struct {
	rules          []evalpkg.RuleDefinition
	evaluators     map[string]evalpkg.EvaluatorDefinition
	enqueued       []evalpkg.WorkItem
	listRulesCalls int
}

func (s *engineTestStore) ListEnabledRules(_ context.Context, _ string) ([]evalpkg.RuleDefinition, error) {
	s.listRulesCalls++
	out := make([]evalpkg.RuleDefinition, len(s.rules))
	copy(out, s.rules)
	return out, nil
}

func (s *engineTestStore) GetEvaluator(_ context.Context, _ string, evaluatorID string) (*evalpkg.EvaluatorDefinition, error) {
	evaluator, ok := s.evaluators[evaluatorID]
	if !ok {
		return nil, nil
	}
	copied := evaluator
	return &copied, nil
}

func (s *engineTestStore) EnqueueWorkItem(_ context.Context, item evalpkg.WorkItem) error {
	s.enqueued = append(s.enqueued, item)
	return nil
}

func strPtr(value string) *string {
	v := value
	return &v
}
