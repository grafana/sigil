package promptinsights

import (
	"context"
	"strings"
	"testing"

	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
)

type mockJudgeClient struct {
	response  judges.JudgeResponse
	err       error
	lastReq   judges.JudgeRequest
	judgeFunc func(req judges.JudgeRequest) (judges.JudgeResponse, error)
}

func (m *mockJudgeClient) Judge(_ context.Context, req judges.JudgeRequest) (judges.JudgeResponse, error) {
	m.lastReq = req
	if m.judgeFunc != nil {
		return m.judgeFunc(req)
	}
	if m.err != nil {
		return judges.JudgeResponse{}, m.err
	}
	return m.response, nil
}

func (m *mockJudgeClient) ListModels(_ context.Context) ([]judges.JudgeModel, error) {
	return nil, nil
}

type mockResolver struct {
	clients map[string]judges.JudgeClient
}

func (r mockResolver) Client(providerID string) (judges.JudgeClient, bool) {
	client, ok := r.clients[providerID]
	return client, ok
}

func TestAnalyzer_Analyze(t *testing.T) {
	goodOutput := `{
		"strengths": [
			{"quote": "Always explain step by step", "title": "Clear reasoning", "explanation": "Agent reasons well"},
			{"quote": "Never execute destructive ops", "title": "Safety guardrail", "explanation": "Prevents harm"},
			{"quote": "Use systematic approaches", "title": "Structured debugging", "explanation": "Efficient debugging"}
		],
		"weaknesses": [
			{"quote": "Be concise but thorough", "title": "Contradictory", "explanation": "Inconsistent lengths"},
			{"quote": "helpful assistant", "title": "Vague role", "explanation": "Role too generic"},
			{"quote": "ask clarifying questions", "title": "Over-clarification", "explanation": "Slows simple tasks"}
		]
	}`

	tests := []struct {
		name             string
		systemPrompt     string
		excerpts         []ConversationExcerpt
		modelOverride    string
		judgeText        string
		judgeErr         error
		expectErr        bool
		expectStrengths  int
		expectWeaknesses int
	}{
		{
			name:             "successful analysis",
			systemPrompt:     "You are a helpful assistant.",
			judgeText:        goodOutput,
			expectStrengths:  3,
			expectWeaknesses: 3,
		},
		{
			name:         "judge error",
			systemPrompt: "You are a helpful assistant.",
			judgeErr:     context.DeadlineExceeded,
			expectErr:    true,
		},
		{
			name:         "empty judge response",
			systemPrompt: "You are a helpful assistant.",
			judgeText:    "",
			expectErr:    true,
		},
		{
			name:             "with conversation excerpts",
			systemPrompt:     "You are a coding assistant.",
			excerpts:         []ConversationExcerpt{{ConversationID: "conv-1", GenerationCount: 3, UserInput: "Help me debug", AssistantOutput: "Let me check..."}},
			judgeText:        goodOutput,
			expectStrengths:  3,
			expectWeaknesses: 3,
		},
		{
			name:             "model override with provider",
			systemPrompt:     "You are an assistant.",
			modelOverride:    "anthropic/claude-sonnet-4-5",
			judgeText:        goodOutput,
			expectStrengths:  3,
			expectWeaknesses: 3,
		},
		{
			name:             "partial insights - empty titles filtered",
			systemPrompt:     "You are a helpful assistant.",
			judgeText:        `{"strengths":[{"quote":"Always explain","title":"Good","explanation":"ok"},{"quote":"x","title":"","explanation":"bad"}],"weaknesses":[]}`,
			expectStrengths:  1,
			expectWeaknesses: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockJudgeClient{
				response: judges.JudgeResponse{Text: tt.judgeText, LatencyMs: 100},
				err:      tt.judgeErr,
			}

			resolverClients := map[string]judges.JudgeClient{"openai": mock}
			if tt.modelOverride != "" && strings.Contains(tt.modelOverride, "/") {
				parts := strings.SplitN(tt.modelOverride, "/", 2)
				resolverClients[parts[0]] = mock
			}

			analyzer := &Analyzer{
				resolver:          mockResolver{clients: resolverClients},
				defaultProviderID: "openai",
				defaultModelName:  "gpt-4o-mini",
				thinking:          defaultThinkingConfig(),
			}

			result, err := analyzer.Analyze(context.Background(), tt.systemPrompt, tt.excerpts, tt.modelOverride)
			if tt.expectErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result == nil {
				t.Fatal("expected non-nil result")
			}
			if len(result.Strengths) != tt.expectStrengths {
				t.Errorf("expected %d strengths, got %d", tt.expectStrengths, len(result.Strengths))
			}
			if len(result.Weaknesses) != tt.expectWeaknesses {
				t.Errorf("expected %d weaknesses, got %d", tt.expectWeaknesses, len(result.Weaknesses))
			}
			if result.Status != StatusCompleted {
				t.Errorf("expected status %q, got %q", StatusCompleted, result.Status)
			}
			if result.JudgeLatencyMs != 100 {
				t.Errorf("expected latency 100, got %d", result.JudgeLatencyMs)
			}
		})
	}
}

func TestAnalyzer_NilResolver(t *testing.T) {
	analyzer := &Analyzer{}
	_, err := analyzer.Analyze(context.Background(), "prompt", nil, "")
	if err == nil {
		t.Fatal("expected error for nil resolver")
	}
}

func TestAnalyzer_UnknownProvider(t *testing.T) {
	analyzer := &Analyzer{
		resolver:          mockResolver{clients: map[string]judges.JudgeClient{}},
		defaultProviderID: "openai",
		defaultModelName:  "gpt-4o-mini",
	}
	_, err := analyzer.Analyze(context.Background(), "prompt", nil, "")
	if err == nil {
		t.Fatal("expected error for unknown provider")
	}
	if !IsValidationError(err) {
		t.Errorf("expected validation error, got: %v", err)
	}
}
