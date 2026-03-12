package googleadk_test

import (
	"context"
	"testing"

	googleadk "github.com/grafana/sigil/sdks/go-frameworks/google-adk"
	"github.com/grafana/sigil/sdks/go/sigil"
)

func boolPtr(v bool) *bool {
	return &v
}

func TestConformance_RunLifecyclePropagatesFrameworkContext(t *testing.T) {
	env := newConformanceEnv(t)

	adapter := googleadk.NewSigilAdapter(env.Client, googleadk.Options{
		AgentName:      "google-adk-agent",
		AgentVersion:   "2026.03.12",
		CaptureInputs:  boolPtr(true),
		CaptureOutputs: boolPtr(true),
	})

	retryAttempt := 2
	parentCtx, parentSpan := env.tracerProvider.Tracer("google-adk-framework").Start(context.Background(), "framework-run")
	parentSpanContext := parentSpan.SpanContext()

	if err := adapter.OnRunStart(parentCtx, googleadk.RunStartEvent{
		RunID:         "run-sync",
		ParentRunID:   "parent-run",
		SessionID:     "session-42",
		ThreadID:      "thread-42",
		EventID:       "event-42",
		ComponentName: "planner",
		RunType:       "chat",
		RetryAttempt:  &retryAttempt,
		ModelName:     "gpt-5",
		Prompts:       []string{"hello"},
		Tags:          []string{"prod", "framework"},
		Metadata: map[string]any{
			"environment": "staging",
		},
	}); err != nil {
		t.Fatalf("run start: %v", err)
	}

	if err := adapter.OnRunEnd("run-sync", googleadk.RunEndEvent{
		RunID:          "run-sync",
		OutputMessages: []sigil.Message{sigil.AssistantTextMessage("world")},
		ResponseModel:  "gpt-5-20260312",
		StopReason:     "stop",
		Usage: sigil.TokenUsage{
			InputTokens:  4,
			OutputTokens: 2,
			TotalTokens:  6,
		},
	}); err != nil {
		t.Fatalf("run end: %v", err)
	}

	parentSpan.End()
	env.Shutdown(t)

	span := findGenerationSpan(t, env.Spans.Ended(), "generateText")
	if span.Parent().SpanID() != parentSpanContext.SpanID() {
		t.Fatalf("expected generation span parent %q, got %q", parentSpanContext.SpanID().String(), span.Parent().SpanID().String())
	}

	attrs := spanAttrs(span)
	requireSpanAttrString(t, attrs, frameworkNameAttr, "google-adk")
	requireSpanAttrString(t, attrs, frameworkSourceAttr, "handler")
	requireSpanAttrString(t, attrs, frameworkLanguageAttr, "go")
	requireSpanAttrString(t, attrs, frameworkRunIDAttr, "run-sync")
	requireSpanAttrString(t, attrs, frameworkThreadIDAttr, "thread-42")
	requireSpanAttrString(t, attrs, frameworkParentRunID, "parent-run")
	requireSpanAttrString(t, attrs, frameworkComponent, "planner")
	requireSpanAttrString(t, attrs, frameworkRunType, "chat")
	requireSpanAttrString(t, attrs, frameworkEventIDAttr, "event-42")
	requireSpanAttrInt(t, attrs, frameworkRetryAttr, 2)
	requireSpanAttrStringSlice(t, attrs, frameworkTagsAttr, []string{"prod", "framework"})

	generation := env.Ingest.SingleGeneration(t)
	requireGenerationTag(t, generation, frameworkNameAttr, "google-adk")
	requireGenerationTag(t, generation, frameworkSourceAttr, "handler")
	requireGenerationTag(t, generation, frameworkLanguageAttr, "go")
	requireGenerationMetadataString(t, generation, frameworkRunIDAttr, "run-sync")
	requireGenerationMetadataString(t, generation, frameworkThreadIDAttr, "thread-42")
	requireGenerationMetadataString(t, generation, frameworkParentRunID, "parent-run")
	requireGenerationMetadataString(t, generation, frameworkComponent, "planner")
	requireGenerationMetadataString(t, generation, frameworkRunType, "chat")
	requireGenerationMetadataString(t, generation, frameworkEventIDAttr, "event-42")
	requireGenerationMetadataInt(t, generation, frameworkRetryAttr, 2)
	requireGenerationMetadataStrings(t, generation, frameworkTagsAttr, []string{"prod", "framework"})

	requireGenerationFieldString(t, generation, "mode", "GENERATION_MODE_SYNC")
	requireGenerationFieldMapString(t, generation, "model", "provider", "openai")
	requireGenerationFieldMapString(t, generation, "model", "name", "gpt-5")
	requireGenerationFieldString(t, generation, "response_model", "gpt-5-20260312")
	requireGenerationFieldString(t, generation, "stop_reason", "stop")
	requireGenerationUsageInt(t, generation, "total_tokens", 6)
	requireGenerationMessageText(t, generation, "input", "hello")
	requireGenerationMessageText(t, generation, "output", "world")
}

func TestConformance_StreamLifecyclePropagatesFrameworkContext(t *testing.T) {
	env := newConformanceEnv(t)

	adapter := googleadk.NewSigilAdapter(env.Client, googleadk.Options{
		CaptureInputs:  boolPtr(true),
		CaptureOutputs: boolPtr(true),
	})

	parentCtx, parentSpan := env.tracerProvider.Tracer("google-adk-framework").Start(context.Background(), "framework-stream")
	parentSpanContext := parentSpan.SpanContext()

	if err := adapter.OnRunStart(parentCtx, googleadk.RunStartEvent{
		RunID:     "run-stream",
		SessionID: "session-stream-42",
		ThreadID:  "thread-stream-42",
		EventID:   "event-stream-42",
		RunType:   "chat",
		ModelName: "claude-sonnet-4-5",
		Prompts:   []string{"stream this"},
		Tags:      []string{"stream"},
		Stream:    true,
		Metadata:  map[string]any{"environment": "test"},
	}); err != nil {
		t.Fatalf("stream start: %v", err)
	}

	adapter.OnRunToken("run-stream", "hello")
	adapter.OnRunToken("run-stream", " world")

	if err := adapter.OnRunEnd("run-stream", googleadk.RunEndEvent{
		RunID:         "run-stream",
		ResponseModel: "claude-sonnet-4-5-20260312",
	}); err != nil {
		t.Fatalf("stream end: %v", err)
	}

	parentSpan.End()
	env.Shutdown(t)

	span := findGenerationSpan(t, env.Spans.Ended(), "streamText")
	if span.Parent().SpanID() != parentSpanContext.SpanID() {
		t.Fatalf("expected generation span parent %q, got %q", parentSpanContext.SpanID().String(), span.Parent().SpanID().String())
	}

	attrs := spanAttrs(span)
	requireSpanAttrString(t, attrs, frameworkNameAttr, "google-adk")
	requireSpanAttrString(t, attrs, frameworkSourceAttr, "handler")
	requireSpanAttrString(t, attrs, frameworkLanguageAttr, "go")
	requireSpanAttrString(t, attrs, frameworkRunIDAttr, "run-stream")
	requireSpanAttrString(t, attrs, frameworkThreadIDAttr, "thread-stream-42")
	requireSpanAttrString(t, attrs, frameworkRunType, "chat")
	requireSpanAttrString(t, attrs, frameworkEventIDAttr, "event-stream-42")
	requireSpanAttrStringSlice(t, attrs, frameworkTagsAttr, []string{"stream"})

	generation := env.Ingest.SingleGeneration(t)
	requireGenerationTag(t, generation, frameworkNameAttr, "google-adk")
	requireGenerationTag(t, generation, frameworkSourceAttr, "handler")
	requireGenerationTag(t, generation, frameworkLanguageAttr, "go")
	requireGenerationMetadataString(t, generation, frameworkRunIDAttr, "run-stream")
	requireGenerationMetadataString(t, generation, frameworkThreadIDAttr, "thread-stream-42")
	requireGenerationMetadataString(t, generation, frameworkRunType, "chat")
	requireGenerationMetadataString(t, generation, frameworkEventIDAttr, "event-stream-42")
	requireGenerationMetadataStrings(t, generation, frameworkTagsAttr, []string{"stream"})

	requireGenerationFieldString(t, generation, "mode", "GENERATION_MODE_STREAM")
	requireGenerationFieldMapString(t, generation, "model", "provider", "anthropic")
	requireGenerationFieldMapString(t, generation, "model", "name", "claude-sonnet-4-5")
	requireGenerationFieldString(t, generation, "response_model", "claude-sonnet-4-5-20260312")
	requireGenerationMessageText(t, generation, "output", "hello world")
}
