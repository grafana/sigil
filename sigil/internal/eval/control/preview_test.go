package control

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"google.golang.org/protobuf/proto"
)

func TestPreviewRuleReturnsErrorWhenNotConfigured(t *testing.T) {
	store := newMemoryControlStore()
	service := NewService(store, nil)

	_, err := service.PreviewRule(context.Background(), "fake", evalpkg.RulePreviewRequest{
		Selector:   evalpkg.SelectorUserVisibleTurn,
		Match:      map[string]any{},
		SampleRate: 1,
	})
	if err == nil {
		t.Fatalf("expected error when preview not configured")
	}
	if !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("expected not configured error, got %v", err)
	}
}

func TestPreviewRuleValidatesRequest(t *testing.T) {
	previewStore := &mockPreviewStore{rows: []storage.RecentGenerationRow{}}
	service := NewServiceWithPreview(newMemoryControlStore(), nil, previewStore, 6)

	_, err := service.PreviewRule(context.Background(), "", evalpkg.RulePreviewRequest{
		Selector:   evalpkg.SelectorUserVisibleTurn,
		Match:      map[string]any{},
		SampleRate: 1,
	})
	if err == nil {
		t.Fatalf("expected error for empty tenant id")
	}

	_, err = service.PreviewRule(context.Background(), "fake", evalpkg.RulePreviewRequest{
		Selector:   evalpkg.Selector("invalid"),
		Match:      map[string]any{},
		SampleRate: 1,
	})
	if err == nil {
		t.Fatalf("expected error for invalid selector")
	}

	_, err = service.PreviewRule(context.Background(), "fake", evalpkg.RulePreviewRequest{
		Selector:   evalpkg.SelectorUserVisibleTurn,
		Match:      map[string]any{},
		SampleRate: 1.5,
	})
	if err == nil {
		t.Fatalf("expected error for sample rate > 1")
	}
}

func TestPreviewRuleFiltersAndSamples(t *testing.T) {
	generation := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		AgentName:      "my-agent",
		Model:          &sigilv1.ModelRef{Provider: "openai", Name: "gpt-4o"},
		Output: []*sigilv1.Message{{
			Role:  sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hello"}}},
		}},
		Input: []*sigilv1.Message{{
			Role:  sigilv1.MessageRole_MESSAGE_ROLE_USER,
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hi there"}}},
		}},
	}
	payload, err := proto.Marshal(generation)
	if err != nil {
		t.Fatalf("marshal generation: %v", err)
	}

	nonMatching := &sigilv1.Generation{
		Id:             "gen-2",
		ConversationId: "conv-2",
		Output:         []*sigilv1.Message{}, // no assistant output
	}
	payloadNonMatching, err := proto.Marshal(nonMatching)
	if err != nil {
		t.Fatalf("marshal non-matching generation: %v", err)
	}

	previewStore := &mockPreviewStore{
		rows: []storage.RecentGenerationRow{
			{GenerationID: "gen-1", ConversationID: strPtr("conv-1"), Payload: payload, CreatedAt: time.Now().UTC()},
			{GenerationID: "gen-2", ConversationID: strPtr("conv-2"), Payload: payloadNonMatching, CreatedAt: time.Now().UTC()},
		},
	}
	service := NewServiceWithPreview(newMemoryControlStore(), nil, previewStore, 6)

	resp, err := service.PreviewRule(context.Background(), "fake", evalpkg.RulePreviewRequest{
		Selector:   evalpkg.SelectorUserVisibleTurn,
		Match:      map[string]any{},
		SampleRate: 1,
	})
	if err != nil {
		t.Fatalf("preview rule: %v", err)
	}

	if resp.WindowHours != 6 {
		t.Fatalf("expected window_hours 6, got %d", resp.WindowHours)
	}
	if resp.TotalGenerations != 2 {
		t.Fatalf("expected total_generations 2, got %d", resp.TotalGenerations)
	}
	if resp.MatchingGenerations != 1 {
		t.Fatalf("expected matching_generations 1, got %d", resp.MatchingGenerations)
	}
	if resp.SampledGenerations != 1 {
		t.Fatalf("expected sampled_generations 1, got %d", resp.SampledGenerations)
	}
	if len(resp.Samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(resp.Samples))
	}
	sample := resp.Samples[0]
	if sample.GenerationID != "gen-1" {
		t.Fatalf("expected generation_id gen-1, got %q", sample.GenerationID)
	}
	if sample.ConversationID != "conv-1" {
		t.Fatalf("expected conversation_id conv-1, got %q", sample.ConversationID)
	}
	if sample.AgentName != "my-agent" {
		t.Fatalf("expected agent_name my-agent, got %q", sample.AgentName)
	}
	if !strings.Contains(sample.Model, "openai") || !strings.Contains(sample.Model, "gpt-4o") {
		t.Fatalf("expected model to contain openai and gpt-4o, got %q", sample.Model)
	}
	if !strings.Contains(sample.InputPreview, "hi there") {
		t.Fatalf("expected input_preview to contain 'hi there', got %q", sample.InputPreview)
	}
}

func TestPreviewRuleWithMatchFilter(t *testing.T) {
	generation := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
		AgentName:      "my-agent",
		Output: []*sigilv1.Message{{
			Role:  sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hello"}}},
		}},
	}
	payload, err := proto.Marshal(generation)
	if err != nil {
		t.Fatalf("marshal generation: %v", err)
	}

	otherAgent := &sigilv1.Generation{
		Id:             "gen-2",
		ConversationId: "conv-2",
		AgentName:      "other-agent",
		Output: []*sigilv1.Message{{
			Role:  sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hi"}}},
		}},
	}
	payloadOther, err := proto.Marshal(otherAgent)
	if err != nil {
		t.Fatalf("marshal other generation: %v", err)
	}

	previewStore := &mockPreviewStore{
		rows: []storage.RecentGenerationRow{
			{GenerationID: "gen-1", ConversationID: strPtr("conv-1"), Payload: payload, CreatedAt: time.Now().UTC()},
			{GenerationID: "gen-2", ConversationID: strPtr("conv-2"), Payload: payloadOther, CreatedAt: time.Now().UTC()},
		},
	}
	service := NewServiceWithPreview(newMemoryControlStore(), nil, previewStore, 6)

	resp, err := service.PreviewRule(context.Background(), "fake", evalpkg.RulePreviewRequest{
		Selector:   evalpkg.SelectorUserVisibleTurn,
		Match:      map[string]any{"agent_name": []string{"my-agent"}},
		SampleRate: 1,
	})
	if err != nil {
		t.Fatalf("preview rule: %v", err)
	}

	if resp.MatchingGenerations != 1 {
		t.Fatalf("expected matching_generations 1 with agent_name filter, got %d", resp.MatchingGenerations)
	}
	if len(resp.Samples) != 1 || resp.Samples[0].GenerationID != "gen-1" {
		t.Fatalf("expected sample gen-1, got %v", resp.Samples)
	}
}

func TestHandleRulesPreviewHTTP(t *testing.T) {
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

	previewStore := &mockPreviewStore{
		rows: []storage.RecentGenerationRow{
			{GenerationID: "gen-1", ConversationID: strPtr("conv-1"), Payload: payload, CreatedAt: time.Now().UTC()},
		},
	}
	service := NewServiceWithPreview(newMemoryControlStore(), nil, previewStore, 6)
	mux := newEvalMux(service)

	previewPayload := `{"selector":"user_visible_turn","match":{},"sample_rate":1}`
	resp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules:preview", previewPayload)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200 preview, got %d body=%s", resp.Code, resp.Body.String())
	}

	var result evalpkg.RulePreviewResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result.TotalGenerations != 1 {
		t.Fatalf("expected total_generations 1, got %d", result.TotalGenerations)
	}
	if len(result.Samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(result.Samples))
	}
}

func TestHandleRulesPreviewReturns400WhenNotConfigured(t *testing.T) {
	service := NewService(newMemoryControlStore(), nil)
	mux := newEvalMux(service)

	previewPayload := `{"selector":"user_visible_turn","match":{},"sample_rate":1}`
	resp := doRequest(mux, http.MethodPost, "/api/v1/eval/rules:preview", previewPayload)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when preview not configured, got %d body=%s", resp.Code, resp.Body.String())
	}
}

type mockPreviewStore struct {
	rows []storage.RecentGenerationRow
}

func (m *mockPreviewStore) ListRecentGenerations(_ context.Context, _ string, _ time.Time, limit int) ([]storage.RecentGenerationRow, error) {
	if limit <= 0 {
		limit = 1000
	}
	if len(m.rows) <= limit {
		return m.rows, nil
	}
	return m.rows[:limit], nil
}

func TestTruncateWithEllipsisUTF8(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		maxLen int
		want   string
	}{
		{
			name:   "ascii within limit",
			input:  "hello",
			maxLen: 10,
			want:   "hello",
		},
		{
			name:   "ascii truncated",
			input:  "hello world",
			maxLen: 8,
			want:   "hello...",
		},
		{
			name:   "multibyte within limit",
			input:  "你好世界",
			maxLen: 10,
			want:   "你好世界",
		},
		{
			name:   "multibyte truncated preserves rune boundary",
			input:  "你好世界再见",
			maxLen: 5,
			want:   "你好...",
		},
		{
			name:   "emoji truncated preserves rune boundary",
			input:  "👋🌍🎉✨🚀🎯",
			maxLen: 5,
			want:   "👋🌍...",
		},
		{
			name:   "maxLen 3 returns ellipsis-length slice",
			input:  "abcdef",
			maxLen: 3,
			want:   "abc",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncateWithEllipsis(tt.input, tt.maxLen)
			if got != tt.want {
				t.Fatalf("truncateWithEllipsis(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
			}
		})
	}
}

func TestInputPreviewFromGeneration(t *testing.T) {
	tests := []struct {
		name string
		gen  *sigilv1.Generation
		want string
	}{
		{
			name: "nil generation",
			gen:  nil,
			want: "",
		},
		{
			name: "single short message",
			gen: &sigilv1.Generation{
				Input: []*sigilv1.Message{{
					Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "hello"}}},
				}},
			},
			want: "hello",
		},
		{
			name: "multiple parts joined by newline",
			gen: &sigilv1.Generation{
				Input: []*sigilv1.Message{
					{Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "first"}}}},
					{Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: "second"}}}},
				},
			},
			want: "first\nsecond",
		},
		{
			name: "long input truncated at 200 runes",
			gen: &sigilv1.Generation{
				Input: []*sigilv1.Message{{
					Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: strings.Repeat("a", 250)}}},
				}},
			},
			want: strings.Repeat("a", 197) + "...",
		},
		{
			name: "multibyte runes counted correctly",
			gen: &sigilv1.Generation{
				Input: []*sigilv1.Message{{
					Parts: []*sigilv1.Part{{Payload: &sigilv1.Part_Text{Text: strings.Repeat("你", 250)}}},
				}},
			},
			want: strings.Repeat("你", 197) + "...",
		},
		{
			name: "whitespace-only parts skipped",
			gen: &sigilv1.Generation{
				Input: []*sigilv1.Message{{
					Parts: []*sigilv1.Part{
						{Payload: &sigilv1.Part_Text{Text: "  "}},
						{Payload: &sigilv1.Part_Text{Text: "content"}},
					},
				}},
			},
			want: "content",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := inputPreviewFromGeneration(tt.gen)
			if got != tt.want {
				t.Fatalf("inputPreviewFromGeneration() = %q (len %d runes), want %q (len %d runes)",
					got, len([]rune(got)), tt.want, len([]rune(tt.want)))
			}
		})
	}
}

func strPtr(s string) *string {
	return &s
}
