package agentrating

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
)

type mockJudgeClient struct {
	response  judges.JudgeResponse
	err       error
	lastReq   judges.JudgeRequest
	requests  []judges.JudgeRequest
	judgeFunc func(req judges.JudgeRequest) (judges.JudgeResponse, error)
}

func (m *mockJudgeClient) Judge(_ context.Context, req judges.JudgeRequest) (judges.JudgeResponse, error) {
	m.lastReq = req
	m.requests = append(m.requests, req)
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

func TestRaterRateWithModel_TableDriven(t *testing.T) {
	baseAgent := Agent{
		Name:         "support-agent",
		SystemPrompt: "You are a support assistant. Follow the runbook and use tools before answering factual questions.",
		Tools: []Tool{
			{
				Name:            "search_incidents",
				Description:     "Search incidents by service and severity.",
				Type:            "function",
				InputSchemaJSON: `{"type":"object","properties":{"service":{"type":"string"},"severity":{"type":"string"}},"required":["service"]}`,
				TokenEstimate:   150,
			},
		},
		Models: []string{"openai/gpt-4o-mini"},
		TokenEstimate: TokenEstimate{
			SystemPrompt: 600,
			ToolsTotal:   500,
			Total:        1100,
		},
	}

	testCases := []struct {
		name          string
		agent         Agent
		modelOverride string
		judgeText     string
		judgeErr      error
		expectErr     bool
		expectScore   int
		expectWarning bool
		expectNoTools bool
	}{
		{
			name:          "good agent response",
			agent:         baseAgent,
			judgeText:     `{"score":8,"summary":"Strong overall prompt and tool hygiene.","suggestions":[{"category":"tools","severity":"medium","title":"Clarify optional fields","description":"Document when optional parameters should be used."}]}`,
			expectScore:   8,
			expectWarning: false,
		},
		{
			name: "poor agent with high token budget warning",
			agent: Agent{
				Name:         baseAgent.Name,
				SystemPrompt: baseAgent.SystemPrompt,
				Tools:        baseAgent.Tools,
				Models:       baseAgent.Models,
				TokenEstimate: TokenEstimate{
					SystemPrompt: 18_000,
					ToolsTotal:   16_500,
					Total:        34_500,
				},
			},
			judgeText:     `{"score":3,"summary":"Prompt and tool design have major issues.","suggestions":[{"category":"system_prompt","severity":"high","title":"Reduce conflicting instructions","description":"Remove contradictory directives and simplify task order."}]}`,
			expectScore:   3,
			expectWarning: true,
		},
		{
			name: "empty prompt still rates",
			agent: Agent{
				Name:         "empty-prompt-agent",
				SystemPrompt: "",
				Tools:        baseAgent.Tools,
				Models:       baseAgent.Models,
				TokenEstimate: TokenEstimate{
					SystemPrompt: 0,
					ToolsTotal:   400,
					Total:        400,
				},
			},
			judgeText:     `{"score":4,"summary":"Missing system prompt role and operating policy.","suggestions":[{"category":"system_prompt","severity":"high","title":"Add a role statement","description":"Start with a clear role and responsibility section."}]}`,
			expectScore:   4,
			expectWarning: false,
		},
		{
			name: "no tools still rates",
			agent: Agent{
				Name:         "no-tools-agent",
				SystemPrompt: "You are a concise assistant.",
				Tools:        []Tool{},
				Models:       []string{"openai/gpt-4o-mini"},
				TokenEstimate: TokenEstimate{
					SystemPrompt: 220,
					ToolsTotal:   0,
					Total:        220,
				},
			},
			judgeText:     `{"score":5,"summary":"Prompt is acceptable but lacks tooling coverage.","suggestions":[{"category":"tools","severity":"medium","title":"Add retrieval tools","description":"Introduce focused retrieval tools for factual grounding."}]}`,
			expectScore:   5,
			expectWarning: false,
			expectNoTools: true,
		},
		{
			name:          "judge call error",
			agent:         baseAgent,
			judgeErr:      errors.New("provider timeout"),
			expectErr:     true,
			expectScore:   0,
			expectWarning: false,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			client := &mockJudgeClient{
				response: judges.JudgeResponse{
					Text:      testCase.judgeText,
					Model:     "gpt-4o-mini",
					LatencyMs: 123,
				},
				err: testCase.judgeErr,
			}
			rater := &Rater{
				resolver:          mockResolver{clients: map[string]judges.JudgeClient{"openai": client}},
				defaultProviderID: "openai",
				defaultModelName:  "gpt-4o-mini",
			}

			rating, err := rater.RateWithModel(context.Background(), testCase.agent, testCase.modelOverride)
			if testCase.expectErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if rating == nil {
				t.Fatalf("expected rating, got nil")
			}
			if rating.Score != testCase.expectScore {
				t.Fatalf("unexpected score: got=%d want=%d", rating.Score, testCase.expectScore)
			}
			if rating.JudgeModel != "openai/gpt-4o-mini" {
				t.Fatalf("unexpected judge model: got=%q", rating.JudgeModel)
			}
			if client.lastReq.OutputSchema == nil {
				t.Fatalf("expected OutputSchema to be set")
			}
			if client.lastReq.Thinking.ModeOrDefault() != judges.ThinkingModeOff {
				t.Fatalf("expected default thinking mode off, got %q", client.lastReq.Thinking.ModeOrDefault())
			}
			if client.lastReq.Thinking.AnthropicModeOrDefault() != judges.AnthropicThinkingModeAdaptive {
				t.Fatalf("expected default anthropic thinking mode adaptive, got %q", client.lastReq.Thinking.AnthropicModeOrDefault())
			}
			if !strings.Contains(client.lastReq.UserPrompt, "<agent_profile>") {
				t.Fatalf("expected user prompt to include <agent_profile>")
			}
			if testCase.expectNoTools && !strings.Contains(client.lastReq.UserPrompt, "<tool name=\"none\" />") {
				t.Fatalf("expected no-tools marker in user prompt")
			}
			if testCase.expectWarning && strings.TrimSpace(rating.TokenWarning) == "" {
				t.Fatalf("expected token warning for high token budget")
			}
			if !testCase.expectWarning && strings.TrimSpace(rating.TokenWarning) != "" {
				t.Fatalf("did not expect token warning, got=%q", rating.TokenWarning)
			}
		})
	}
}

func TestRaterRateWithModel_OverrideProviderAndModel(t *testing.T) {
	client := &mockJudgeClient{
		response: judges.JudgeResponse{
			Text:      `{"score":7,"summary":"Good design with moderate improvements needed.","suggestions":[]}`,
			Model:     "claude-sonnet-4-5",
			LatencyMs: 87,
		},
	}
	rater := &Rater{
		resolver: mockResolver{
			clients: map[string]judges.JudgeClient{
				"openai":    &mockJudgeClient{},
				"anthropic": client,
			},
		},
		defaultProviderID: "openai",
		defaultModelName:  "gpt-4o-mini",
	}

	rating, err := rater.RateWithModel(context.Background(), Agent{
		Name:         "override-test",
		SystemPrompt: "You are an assistant.",
		Tools:        []Tool{},
		Models:       []string{"anthropic/claude-sonnet-4-5"},
		TokenEstimate: TokenEstimate{
			SystemPrompt: 100,
			ToolsTotal:   0,
			Total:        100,
		},
	}, "anthropic/claude-sonnet-4-5")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rating == nil {
		t.Fatalf("expected rating, got nil")
	}
	if client.lastReq.Model != "claude-sonnet-4-5" {
		t.Fatalf("expected overridden model name, got=%q", client.lastReq.Model)
	}
}

func TestRaterRateWithModel_FallbacksWhenThinkingIsUnsupported(t *testing.T) {
	callCount := 0
	client := &mockJudgeClient{
		judgeFunc: func(req judges.JudgeRequest) (judges.JudgeResponse, error) {
			callCount++
			if callCount == 1 {
				return judges.JudgeResponse{}, errors.New("invalid_request_error: reasoning_effort is not supported for this model")
			}
			return judges.JudgeResponse{
				Text:      `{"score":7,"summary":"Good design with moderate improvements needed.","suggestions":[]}`,
				Model:     "gpt-4o-mini",
				LatencyMs: 45,
			}, nil
		},
	}
	rater := &Rater{
		resolver:          mockResolver{clients: map[string]judges.JudgeClient{"openai": client}},
		defaultProviderID: "openai",
		defaultModelName:  "gpt-4o-mini",
		thinking: judges.ThinkingConfig{
			Mode:  judges.ThinkingModePrefer,
			Level: judges.ThinkingLevelMedium,
		},
	}

	rating, err := rater.RateWithModel(context.Background(), Agent{
		Name:         "fallback-test",
		SystemPrompt: "You are an assistant.",
		Tools:        []Tool{},
		Models:       []string{"openai/gpt-4o-mini"},
		TokenEstimate: TokenEstimate{
			SystemPrompt: 120,
			ToolsTotal:   0,
			Total:        120,
		},
	}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rating == nil {
		t.Fatalf("expected rating, got nil")
	}
	if len(client.requests) != 2 {
		t.Fatalf("expected two judge calls after fallback, got %d", len(client.requests))
	}
	if client.requests[0].Thinking.ModeOrDefault() != judges.ThinkingModePrefer {
		t.Fatalf("expected first call thinking mode prefer, got %q", client.requests[0].Thinking.ModeOrDefault())
	}
	if client.requests[1].Thinking.ModeOrDefault() != judges.ThinkingModeOff {
		t.Fatalf("expected fallback call thinking mode off, got %q", client.requests[1].Thinking.ModeOrDefault())
	}
}

func TestRaterRateWithModel_ReturnsValidationErrorForUnknownProvider(t *testing.T) {
	rater := &Rater{
		resolver:          mockResolver{clients: map[string]judges.JudgeClient{}},
		defaultProviderID: "openai",
		defaultModelName:  "gpt-4o-mini",
	}
	_, err := rater.RateWithModel(context.Background(), Agent{
		Name:         "unknown-provider",
		SystemPrompt: "You are an assistant.",
	}, "anthropic/claude-sonnet-4-5")
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if !IsValidationError(err) {
		t.Fatalf("expected validation error, got=%T %v", err, err)
	}
}

func TestNewRaterWithTarget_DefaultFallback(t *testing.T) {
	rater := NewRaterWithTarget(judges.NewDiscovery(), "", "")
	if rater == nil {
		t.Fatalf("expected non-nil rater")
	}
	if rater.defaultProviderID != "openai" {
		t.Fatalf("expected default provider openai, got %q", rater.defaultProviderID)
	}
	if rater.defaultModelName != "gpt-4o-mini" {
		t.Fatalf("expected default model gpt-4o-mini, got %q", rater.defaultModelName)
	}
	if rater.thinking.ModeOrDefault() != judges.ThinkingModeOff {
		t.Fatalf("expected default thinking mode off, got %q", rater.thinking.ModeOrDefault())
	}
	if rater.thinking.AnthropicModeOrDefault() != judges.AnthropicThinkingModeAdaptive {
		t.Fatalf("expected default anthropic thinking mode adaptive, got %q", rater.thinking.AnthropicModeOrDefault())
	}
}

func TestNewRaterWithTarget_UsesExplicitProviderAndModel(t *testing.T) {
	rater := NewRaterWithTarget(judges.NewDiscovery(), "anthropic", "claude-sonnet-4-5")
	if rater == nil {
		t.Fatalf("expected non-nil rater")
	}
	if rater.defaultProviderID != "anthropic" {
		t.Fatalf("expected provider anthropic, got %q", rater.defaultProviderID)
	}
	if rater.defaultModelName != "claude-sonnet-4-5" {
		t.Fatalf("expected model claude-sonnet-4-5, got %q", rater.defaultModelName)
	}
}
