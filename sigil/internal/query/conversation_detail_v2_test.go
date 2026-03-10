package query

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestGetConversationDetailV2ForTenantInternsSharedPayloads(t *testing.T) {
	base := time.Date(2026, 3, 10, 10, 0, 0, 0, time.UTC)
	conversationStore := &stubConversationStore{
		items: map[string]storage.Conversation{
			"conv-1": {
				TenantID:         "tenant-a",
				ConversationID:   "conv-1",
				GenerationCount:  2,
				CreatedAt:        base,
				LastGenerationAt: base.Add(2 * time.Minute),
				UpdatedAt:        base.Add(2 * time.Minute),
			},
		},
	}

	user1 := &sigilv1.Message{Role: sigilv1.MessageRole_MESSAGE_ROLE_USER, Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hello"}}}}
	assistant1 := &sigilv1.Message{Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT, Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hi"}}}}
	user2 := &sigilv1.Message{Role: sigilv1.MessageRole_MESSAGE_ROLE_USER, Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "summarize"}}}}
	assistant2 := &sigilv1.Message{Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT, Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "done"}}}}

	tool := &sigilv1.ToolDefinition{Name: "search_docs", Description: "Search docs", Type: "function", InputSchemaJson: []byte(`{"type":"object"}`)}
	metadata := &structpb.Struct{Fields: map[string]*structpb.Value{"channel": structpb.NewStringValue("assistant")}}

	gen1 := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		TraceId:        "trace-1",
		SpanId:         "span-1",
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-4o"},
		SystemPrompt:   "You are helpful.",
		Input:          []*sigilv1.Message{user1},
		Output:         []*sigilv1.Message{assistant1},
		Tools:          []*sigilv1.ToolDefinition{tool},
		Metadata:       metadata,
		CompletedAt:    timestamppb.New(base.Add(time.Minute)),
		AgentName:      "assistant",
	}
	gen2 := &sigilv1.Generation{
		Id:             "gen-2",
		ConversationId: "conv-1",
		TraceId:        "trace-2",
		SpanId:         "span-2",
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_SYNC,
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-4o"},
		SystemPrompt:   "You are helpful.",
		Input:          []*sigilv1.Message{user1, assistant1, user2},
		Output:         []*sigilv1.Message{assistant2},
		Tools:          []*sigilv1.ToolDefinition{tool},
		Metadata:       metadata,
		CompletedAt:    timestamppb.New(base.Add(2 * time.Minute)),
		AgentName:      "assistant",
	}

	walReader := &stubWALReader{
		byConversationByTenant: map[string]map[string][]*sigilv1.Generation{
			"tenant-a": {"conv-1": {gen1, gen2}},
		},
	}

	service := NewServiceWithStores(conversationStore, feedback.NewMemoryStore())
	service.walReader = walReader
	service.fanOutStore = storage.NewFanOutStore(walReader, nil, nil)

	detail, found, err := service.GetConversationDetailV2ForTenant(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("get conversation detail v2: %v", err)
	}
	if !found {
		t.Fatalf("expected conversation detail v2 to be found")
	}
	if got := len(detail.Shared.Messages); got != 4 {
		t.Fatalf("expected 4 unique shared messages, got %d", got)
	}
	if got := len(detail.Shared.Tools); got != 1 {
		t.Fatalf("expected 1 shared tool, got %d", got)
	}
	if got := len(detail.Shared.SystemPrompts); got != 1 {
		t.Fatalf("expected 1 shared system prompt, got %d", got)
	}
	if got := len(detail.Shared.Metadata); got != 1 {
		t.Fatalf("expected 1 shared metadata entry, got %d", got)
	}
	if got := len(detail.Generations); got != 2 {
		t.Fatalf("expected 2 generations, got %d", got)
	}

	firstRefs, ok := detail.Generations[0]["input_refs"].([]int)
	if !ok {
		t.Fatalf("expected input_refs on first generation, got %#v", detail.Generations[0]["input_refs"])
	}
	secondRefs, ok := detail.Generations[1]["input_refs"].([]int)
	if !ok {
		t.Fatalf("expected input_refs on second generation, got %#v", detail.Generations[1]["input_refs"])
	}
	if len(firstRefs) != 1 || len(secondRefs) != 3 {
		t.Fatalf("unexpected input refs lengths: first=%v second=%v", firstRefs, secondRefs)
	}
	if firstRefs[0] != secondRefs[0] {
		t.Fatalf("expected repeated first input message to reuse ref, got %v and %v", firstRefs, secondRefs)
	}
	if toolRefs, ok := detail.Generations[1]["tool_refs"].([]int); !ok || len(toolRefs) != 1 || toolRefs[0] != 0 {
		t.Fatalf("expected tool_refs [0], got %#v", detail.Generations[1]["tool_refs"])
	}
	if promptRef, ok := detail.Generations[1]["system_prompt_ref"].(int); !ok || promptRef != 0 {
		t.Fatalf("expected system_prompt_ref 0, got %#v", detail.Generations[1]["system_prompt_ref"])
	}
	if metadataRef, ok := detail.Generations[1]["metadata_ref"].(int); !ok || metadataRef != 0 {
		t.Fatalf("expected metadata_ref 0, got %#v", detail.Generations[1]["metadata_ref"])
	}
	for _, generation := range detail.Generations {
		for _, field := range []string{"input", "output", "tools", "system_prompt", "metadata"} {
			if _, exists := generation[field]; exists {
				t.Fatalf("expected %s to be interned and removed from generation payload: %#v", field, generation)
			}
		}
	}
}

func TestBuildConversationDetailV2PreservesEmptyArraysAndObjects(t *testing.T) {
	now := time.Now().UTC()
	detail := ConversationDetail{
		ConversationID:    "conv-empty",
		GenerationCount:   1,
		FirstGenerationAt: now,
		LastGenerationAt:  now,
		Generations: []map[string]any{
			{
				"generation_id":   "gen-1",
				"conversation_id": "conv-empty",
				"input":           []any{},
				"output":          []any{},
				"tools":           []any{},
				"metadata":        map[string]any{},
			},
		},
	}

	v2, err := BuildConversationDetailV2(detail)
	if err != nil {
		t.Fatalf("BuildConversationDetailV2: %v", err)
	}
	if len(v2.Generations) != 1 {
		t.Fatalf("expected 1 generation, got %d", len(v2.Generations))
	}

	gen := v2.Generations[0]

	inputRefs, ok := gen["input_refs"].([]int)
	if !ok {
		t.Fatalf("expected input_refs to be []int, got %T (%#v)", gen["input_refs"], gen["input_refs"])
	}
	if !reflect.DeepEqual(inputRefs, []int{}) {
		t.Errorf("expected input_refs to be empty, got %v", inputRefs)
	}

	outputRefs, ok := gen["output_refs"].([]int)
	if !ok {
		t.Fatalf("expected output_refs to be []int, got %T (%#v)", gen["output_refs"], gen["output_refs"])
	}
	if !reflect.DeepEqual(outputRefs, []int{}) {
		t.Errorf("expected output_refs to be empty, got %v", outputRefs)
	}

	toolRefs, ok := gen["tool_refs"].([]int)
	if !ok {
		t.Fatalf("expected tool_refs to be []int, got %T (%#v)", gen["tool_refs"], gen["tool_refs"])
	}
	if !reflect.DeepEqual(toolRefs, []int{}) {
		t.Errorf("expected tool_refs to be empty, got %v", toolRefs)
	}

	metadataRef, ok := gen["metadata_ref"].(int)
	if !ok {
		t.Fatalf("expected metadata_ref to be int, got %T (%#v)", gen["metadata_ref"], gen["metadata_ref"])
	}
	if metadataRef != 0 {
		t.Errorf("expected metadata_ref 0, got %d", metadataRef)
	}
	if len(v2.Shared.Metadata) != 1 {
		t.Fatalf("expected 1 shared metadata entry for empty object, got %d", len(v2.Shared.Metadata))
	}

	for _, field := range []string{"input", "output", "tools", "metadata"} {
		if _, exists := gen[field]; exists {
			t.Errorf("expected raw %s field to be removed after interning, but it is still present", field)
		}
	}
}
