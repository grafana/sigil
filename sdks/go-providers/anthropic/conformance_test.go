package anthropic

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	asdk "github.com/anthropics/anthropic-sdk-go"

	sigil "github.com/grafana/sigil/sdks/go/sigil"
	"github.com/grafana/sigil/sdks/go/sigil/sigiltest"
)

const anthropicSpanErrorCategory = "error.category"

func TestConformance_AnthropicSyncMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	req := testRequest()
	resp := &asdk.BetaMessage{
		ID:         "msg_conformance_sync",
		Model:      asdk.Model("claude-sonnet-4-5"),
		StopReason: asdk.BetaStopReasonToolUse,
		Content: []asdk.BetaContentBlockUnion{
			mustUnmarshalBetaContentBlockUnion(t, `{"type":"thinking","thinking":"need weather tool","signature":"sig"}`),
			mustUnmarshalBetaContentBlockUnion(t, `{"type":"text","text":"Checking weather."}`),
			mustUnmarshalBetaContentBlockUnion(t, `{"type":"tool_use","id":"toolu_sync","name":"weather","input":{"city":"Paris"}}`),
		},
		Usage: asdk.BetaUsage{
			InputTokens:              120,
			OutputTokens:             42,
			CacheReadInputTokens:     30,
			CacheCreationInputTokens: 10,
			ServerToolUse: asdk.BetaServerToolUsage{
				WebSearchRequests: 2,
				WebFetchRequests:  1,
			},
		},
	}
	start := sigil.GenerationStart{
		ConversationID:    "conv-anthropic-sync",
		ConversationTitle: "Anthropic sync",
		AgentName:         "agent-anthropic",
		AgentVersion:      "v-anthropic",
		Model:             sigil.ModelRef{Provider: "anthropic", Name: string(req.Model)},
	}

	generation, err := FromRequestResponse(
		req,
		resp,
		WithConversationID(start.ConversationID),
		WithConversationTitle(start.ConversationTitle),
		WithAgentName(start.AgentName),
		WithAgentVersion(start.AgentVersion),
		WithTag("tenant", "t-anthropic"),
	)
	sigiltest.RecordGeneration(t, env, start, generation, err)
	env.Shutdown(t)

	exported := env.SingleGenerationJSON(t)

	if got := sigiltest.StringValue(t, exported, "mode"); got != "GENERATION_MODE_SYNC" {
		t.Fatalf("unexpected mode: got %q want %q\n%s", got, "GENERATION_MODE_SYNC", sigiltest.DebugJSON(exported))
	}
	if got := sigiltest.StringValue(t, exported, "stop_reason"); got != "tool_use" {
		t.Fatalf("unexpected stop_reason: got %q want %q", got, "tool_use")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 0, "thinking"); got != "need weather tool" {
		t.Fatalf("unexpected thinking part: got %q want %q", got, "need weather tool")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 1, "text"); got != "Checking weather." {
		t.Fatalf("unexpected text part: got %q want %q", got, "Checking weather.")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 2, "tool_call", "name"); got != "weather" {
		t.Fatalf("unexpected tool_call.name: got %q want %q", got, "weather")
	}
	if got := sigiltest.StringValue(t, exported, "input", 2, "role"); got != "MESSAGE_ROLE_TOOL" {
		t.Fatalf("unexpected tool input role: got %q want %q", got, "MESSAGE_ROLE_TOOL")
	}
	if got := sigiltest.StringValue(t, exported, "usage", "cache_read_input_tokens"); got != "30" {
		t.Fatalf("unexpected usage.cache_read_input_tokens: got %q want %q", got, "30")
	}
	if got := sigiltest.StringValue(t, exported, "usage", "cache_write_input_tokens"); got != "10" {
		t.Fatalf("unexpected usage.cache_write_input_tokens: got %q want %q", got, "10")
	}
	if got := sigiltest.FloatValue(t, exported, "metadata", "sigil.gen_ai.usage.server_tool_use.total_requests"); got != 3 {
		t.Fatalf("unexpected server tool total requests: got %v want %v", got, float64(3))
	}
}

func TestConformance_AnthropicStreamMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	req := testRequest()
	summary := StreamSummary{
		FirstChunkAt: time.Unix(1_741_780_100, 0).UTC(),
		Events: []asdk.BetaRawMessageStreamEventUnion{
			{
				Type: "message_start",
				Message: asdk.BetaMessage{
					ID:    "msg_conformance_stream",
					Model: asdk.Model("claude-sonnet-4-5"),
				},
			},
			{
				Type:         "content_block_start",
				Index:        0,
				ContentBlock: mustUnmarshalBetaRawContentBlockStartEventContentBlockUnion(t, `{"type":"thinking","thinking":""}`),
			},
			{
				Type:  "content_block_delta",
				Index: 0,
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{Thinking: "need weather"},
			},
			{
				Type:         "content_block_start",
				Index:        1,
				ContentBlock: mustUnmarshalBetaRawContentBlockStartEventContentBlockUnion(t, `{"type":"text","text":""}`),
			},
			{
				Type:  "content_block_delta",
				Index: 1,
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{Text: "Checking "},
			},
			{
				Type:  "content_block_delta",
				Index: 1,
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{Text: "weather"},
			},
			{
				Type:         "content_block_start",
				Index:        2,
				ContentBlock: mustUnmarshalBetaRawContentBlockStartEventContentBlockUnion(t, `{"type":"tool_use","id":"toolu_stream","name":"weather","input":{}}`),
			},
			{
				Type:  "content_block_delta",
				Index: 2,
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{PartialJSON: `{"city":"Paris"}`},
			},
			{
				Type: "message_delta",
				Delta: asdk.BetaRawMessageStreamEventUnionDelta{
					StopReason: asdk.BetaStopReasonToolUse,
				},
				Usage: asdk.BetaMessageDeltaUsage{
					InputTokens:  80,
					OutputTokens: 25,
				},
			},
		},
	}
	start := sigil.GenerationStart{
		ConversationID: "conv-anthropic-stream",
		AgentName:      "agent-anthropic-stream",
		AgentVersion:   "v-anthropic-stream",
		Model:          sigil.ModelRef{Provider: "anthropic", Name: string(req.Model)},
	}

	generation, err := FromStream(
		req,
		summary,
		WithConversationID(start.ConversationID),
		WithAgentName(start.AgentName),
		WithAgentVersion(start.AgentVersion),
	)
	sigiltest.RecordStreamingGeneration(t, env, start, summary.FirstChunkAt, generation, err)
	env.Shutdown(t)

	exported := env.SingleGenerationJSON(t)

	if got := sigiltest.StringValue(t, exported, "mode"); got != "GENERATION_MODE_STREAM" {
		t.Fatalf("unexpected mode: got %q want %q\n%s", got, "GENERATION_MODE_STREAM", sigiltest.DebugJSON(exported))
	}
	if got := sigiltest.StringValue(t, exported, "response_id"); got != "msg_conformance_stream" {
		t.Fatalf("unexpected response_id: got %q want %q", got, "msg_conformance_stream")
	}
	if got := sigiltest.StringValue(t, exported, "stop_reason"); got != "tool_use" {
		t.Fatalf("unexpected stop_reason: got %q want %q", got, "tool_use")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 0, "thinking"); got != "need weather" {
		t.Fatalf("unexpected streamed thinking part: got %q want %q", got, "need weather")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 1, "text"); got != "Checking weather" {
		t.Fatalf("unexpected streamed text part: got %q want %q", got, "Checking weather")
	}
	if got := sigiltest.StringValue(t, exported, "output", 0, "parts", 2, "tool_call", "name"); got != "weather" {
		t.Fatalf("unexpected streamed tool_call.name: got %q want %q", got, "weather")
	}
	if got := sigiltest.StringValue(t, exported, "usage", "total_tokens"); got != "105" {
		t.Fatalf("unexpected streamed usage.total_tokens: got %q want %q", got, "105")
	}
}

func TestConformance_AnthropicErrorMapping(t *testing.T) {
	env := sigiltest.NewEnv(t)

	callErr := &asdk.Error{
		StatusCode: http.StatusTooManyRequests,
		Request:    &http.Request{Method: http.MethodPost, URL: mustAnthropicURL(t, "https://api.anthropic.com/v1/messages")},
		Response:   &http.Response{StatusCode: http.StatusTooManyRequests, Status: "429 Too Many Requests"},
	}
	sigiltest.RecordCallError(t, env, sigil.GenerationStart{
		Model: sigil.ModelRef{Provider: "anthropic", Name: "claude-sonnet-4-5"},
	}, callErr)

	span := sigiltest.FindSpan(t, env.Spans.Ended(), "generateText claude-sonnet-4-5")
	attrs := sigiltest.SpanAttributes(span)
	if got := attrs[anthropicSpanErrorCategory].AsString(); got != "rate_limit" {
		t.Fatalf("unexpected error.category: got %q want %q", got, "rate_limit")
	}

	env.Shutdown(t)
	exported := env.SingleGenerationJSON(t)
	callError := sigiltest.StringValue(t, exported, "call_error")
	if !strings.Contains(callError, "429") {
		t.Fatalf("expected call_error to include status code, got %q", callError)
	}
}

func mustAnthropicURL(t testing.TB, raw string) *url.URL {
	t.Helper()

	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse url %q: %v", raw, err)
	}
	return parsed
}
