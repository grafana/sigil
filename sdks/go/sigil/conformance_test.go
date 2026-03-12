package sigil_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	sigil "github.com/grafana/sigil/sdks/go/sigil"
	sigilv1 "github.com/grafana/sigil/sdks/go/sigil/internal/gen/sigil/v1"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

func TestConformance_FullGenerationRoundtrip(t *testing.T) {
	env := newConformanceEnv(t)

	startedAt := time.Date(2026, 3, 12, 8, 0, 0, 0, time.UTC)
	completedAt := startedAt.Add(2 * time.Second)
	maxTokens := int64(256)
	temperature := 0.25
	topP := 0.9
	toolChoice := "required"
	thinkingEnabled := true
	toolSchema := json.RawMessage(`{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}`)
	toolCallInput := json.RawMessage(`{"location":"Paris"}`)
	toolResultContent := json.RawMessage(`{"forecast":"sunny","temp_c":22}`)

	requestArtifact, err := sigil.NewJSONArtifact(sigil.ArtifactKindRequest, "request", map[string]any{
		"model": "gpt-5",
	})
	if err != nil {
		t.Fatalf("new request artifact: %v", err)
	}

	responseArtifact, err := sigil.NewJSONArtifact(sigil.ArtifactKindResponse, "response", map[string]any{
		"stop_reason": "end_turn",
	})
	if err != nil {
		t.Fatalf("new response artifact: %v", err)
	}

	parentCtx, parent := env.tracerProvider.Tracer("sigil-conformance-parent").Start(context.Background(), "parent")
	parentSC := parent.SpanContext()

	callCtx, recorder := env.Client.StartGeneration(parentCtx, sigil.GenerationStart{
		ID:                "gen-roundtrip-1",
		ConversationID:    "conv-roundtrip-1",
		ConversationTitle: "Ticket triage",
		UserID:            "user-42",
		AgentName:         "agent-support",
		AgentVersion:      "v1.2.3",
		Model:             conformanceModel,
		SystemPrompt:      "You are a concise support assistant.",
		Tools: []sigil.ToolDefinition{{
			Name:        "lookup_weather",
			Description: "Look up the latest weather conditions",
			Type:        "function",
			InputSchema: toolSchema,
			Deferred:    true,
		}},
		MaxTokens:       &maxTokens,
		Temperature:     &temperature,
		TopP:            &topP,
		ToolChoice:      &toolChoice,
		ThinkingEnabled: &thinkingEnabled,
		Tags: map[string]string{
			"suite": "conformance",
		},
		Metadata: map[string]any{
			"request_id":                  "req-7",
			spanAttrRequestThinkingBudget: int64(4096),
		},
		StartedAt: startedAt,
	})
	callSC := trace.SpanContextFromContext(callCtx)
	if !callSC.IsValid() {
		t.Fatalf("expected valid generation span context")
	}

	recorder.SetResult(sigil.Generation{
		ResponseID:    "resp-7",
		ResponseModel: "gpt-5-2026-03-01",
		Input: []sigil.Message{
			{
				Role:  sigil.RoleUser,
				Name:  "customer",
				Parts: []sigil.Part{sigil.TextPart("What's the weather in Paris?")},
			},
		},
		Output: []sigil.Message{
			{
				Role: sigil.RoleAssistant,
				Parts: []sigil.Part{
					sigil.ThinkingPart("I have the tool result; compose the final answer."),
					sigil.ToolCallPart(sigil.ToolCall{
						ID:        "call-1",
						Name:      "lookup_weather",
						InputJSON: toolCallInput,
					}),
					sigil.TextPart("It is sunny and 22C in Paris."),
				},
			},
			{
				Role: sigil.RoleTool,
				Name: "lookup_weather",
				Parts: []sigil.Part{sigil.ToolResultPart(sigil.ToolResult{
					ToolCallID:  "call-1",
					Name:        "lookup_weather",
					Content:     "sunny, 22C",
					ContentJSON: toolResultContent,
				})},
			},
			sigil.AssistantTextMessage("It is sunny and 22C in Paris."),
		},
		Tags: map[string]string{
			"scenario": "full-roundtrip",
		},
		Metadata: map[string]any{
			"response_format": "text",
		},
		Artifacts: []sigil.Artifact{requestArtifact, responseArtifact},
		Usage: sigil.TokenUsage{
			InputTokens:              120,
			OutputTokens:             36,
			CacheCreationInputTokens: 4,
			CacheReadInputTokens:     5,
			CacheWriteInputTokens:    3,
			ReasoningTokens:          7,
		},
		StopReason:  "end_turn",
		CompletedAt: completedAt,
	}, nil)
	recorder.End()

	if err := recorder.Err(); err != nil {
		t.Fatalf("record generation: %v", err)
	}

	parent.End()

	span := findSpan(t, env.Spans.Ended(), conformanceOperationName)
	if span.Name() != "generateText gpt-5" {
		t.Fatalf("unexpected span name: %q", span.Name())
	}
	if span.SpanKind() != trace.SpanKindClient {
		t.Fatalf("expected client span kind, got %v", span.SpanKind())
	}
	if span.SpanContext().TraceID() != callSC.TraceID() {
		t.Fatalf("unexpected span trace id: got %q want %q", span.SpanContext().TraceID(), callSC.TraceID())
	}
	if span.SpanContext().SpanID() != callSC.SpanID() {
		t.Fatalf("unexpected span span id: got %q want %q", span.SpanContext().SpanID(), callSC.SpanID())
	}
	if span.Parent().SpanID() != parentSC.SpanID() {
		t.Fatalf("unexpected parent span id: got %q want %q", span.Parent().SpanID(), parentSC.SpanID())
	}
	if got := span.Status().Code; got != codes.Ok {
		t.Fatalf("expected ok span status, got %v", got)
	}

	attrs := spanAttrs(span)
	requireSpanAttr(t, attrs, spanAttrGenerationID, "gen-roundtrip-1")
	requireSpanAttr(t, attrs, spanAttrOperationName, conformanceOperationName)
	requireSpanAttr(t, attrs, spanAttrConversationID, "conv-roundtrip-1")
	requireSpanAttr(t, attrs, spanAttrConversationTitle, "Ticket triage")
	requireSpanAttr(t, attrs, spanAttrUserID, "user-42")
	requireSpanAttr(t, attrs, spanAttrAgentName, "agent-support")
	requireSpanAttr(t, attrs, spanAttrAgentVersion, "v1.2.3")
	requireSpanAttr(t, attrs, spanAttrProviderName, conformanceModel.Provider)
	requireSpanAttr(t, attrs, spanAttrRequestModel, conformanceModel.Name)
	requireSpanAttr(t, attrs, spanAttrResponseID, "resp-7")
	requireSpanAttr(t, attrs, spanAttrResponseModel, "gpt-5-2026-03-01")
	requireSpanInt64Attr(t, attrs, spanAttrRequestMaxTokens, maxTokens)
	requireSpanFloat64Attr(t, attrs, spanAttrRequestTemperature, temperature)
	requireSpanFloat64Attr(t, attrs, spanAttrRequestTopP, topP)
	requireSpanAttr(t, attrs, spanAttrRequestToolChoice, toolChoice)
	requireSpanBoolAttr(t, attrs, spanAttrRequestThinkingEnabled, thinkingEnabled)
	requireSpanInt64Attr(t, attrs, spanAttrRequestThinkingBudget, 4096)
	requireSpanStringSliceAttr(t, attrs, spanAttrFinishReasons, []string{"end_turn"})
	requireSpanInt64Attr(t, attrs, spanAttrInputTokens, 120)
	requireSpanInt64Attr(t, attrs, spanAttrOutputTokens, 36)
	requireSpanInt64Attr(t, attrs, spanAttrCacheReadTokens, 5)
	requireSpanInt64Attr(t, attrs, spanAttrCacheWriteTokens, 3)
	requireSpanInt64Attr(t, attrs, spanAttrCacheCreationTokens, 4)
	requireSpanInt64Attr(t, attrs, spanAttrReasoningTokens, 7)
	requireSpanAttr(t, attrs, sdkMetadataKeyName, sdkName)

	metrics := env.CollectMetrics(t)
	duration := findHistogram[float64](t, metrics, metricOperationDuration)
	if len(duration.DataPoints) != 1 {
		t.Fatalf("expected 1 %s datapoint, got %d", metricOperationDuration, len(duration.DataPoints))
	}
	requireHistogramPointFloat64(t, duration, completedAt.Sub(startedAt).Seconds(), map[string]string{
		spanAttrOperationName: conformanceOperationName,
		spanAttrProviderName:  conformanceModel.Provider,
		spanAttrRequestModel:  conformanceModel.Name,
		spanAttrAgentName:     "agent-support",
		spanAttrErrorType:     "",
		spanAttrErrorCategory: "",
	})

	tokenUsage := findHistogram[int64](t, metrics, metricTokenUsage)
	if len(tokenUsage.DataPoints) != 6 {
		t.Fatalf("expected 6 %s datapoints, got %d", metricTokenUsage, len(tokenUsage.DataPoints))
	}
	for tokenType, value := range map[string]int64{
		metricTokenTypeInput:         120,
		metricTokenTypeOutput:        36,
		metricTokenTypeCacheRead:     5,
		metricTokenTypeCacheWrite:    3,
		metricTokenTypeCacheCreation: 4,
		metricTokenTypeReasoning:     7,
	} {
		requireHistogramPointInt64(t, tokenUsage, value, map[string]string{
			spanAttrOperationName: conformanceOperationName,
			spanAttrProviderName:  conformanceModel.Provider,
			spanAttrRequestModel:  conformanceModel.Name,
			spanAttrAgentName:     "agent-support",
			metricAttrTokenType:   tokenType,
		})
	}
	toolCalls := findHistogram[int64](t, metrics, metricToolCallsPerOperation)
	if len(toolCalls.DataPoints) != 1 {
		t.Fatalf("expected 1 %s datapoint, got %d", metricToolCallsPerOperation, len(toolCalls.DataPoints))
	}
	requireHistogramPointInt64(t, toolCalls, 1, map[string]string{
		spanAttrProviderName: conformanceModel.Provider,
		spanAttrRequestModel: conformanceModel.Name,
		spanAttrAgentName:    "agent-support",
	})
	requireNoHistogram(t, metrics, metricTimeToFirstToken)

	env.Shutdown(t)

	generation := env.Ingest.SingleGeneration(t)
	if generation.GetId() != "gen-roundtrip-1" {
		t.Fatalf("unexpected generation id: %q", generation.GetId())
	}
	if generation.GetConversationId() != "conv-roundtrip-1" {
		t.Fatalf("unexpected conversation id: %q", generation.GetConversationId())
	}
	if generation.GetAgentName() != "agent-support" {
		t.Fatalf("unexpected agent name: %q", generation.GetAgentName())
	}
	if generation.GetAgentVersion() != "v1.2.3" {
		t.Fatalf("unexpected agent version: %q", generation.GetAgentVersion())
	}
	if generation.GetOperationName() != conformanceOperationName {
		t.Fatalf("unexpected operation name: %q", generation.GetOperationName())
	}
	if generation.GetMode() != sigilv1.GenerationMode_GENERATION_MODE_SYNC {
		t.Fatalf("unexpected generation mode: %v", generation.GetMode())
	}
	if generation.GetTraceId() != callSC.TraceID().String() {
		t.Fatalf("unexpected trace id: got %q want %q", generation.GetTraceId(), callSC.TraceID().String())
	}
	if generation.GetSpanId() != callSC.SpanID().String() {
		t.Fatalf("unexpected span id: got %q want %q", generation.GetSpanId(), callSC.SpanID().String())
	}
	if generation.GetModel().GetProvider() != conformanceModel.Provider {
		t.Fatalf("unexpected provider: %q", generation.GetModel().GetProvider())
	}
	if generation.GetModel().GetName() != conformanceModel.Name {
		t.Fatalf("unexpected model name: %q", generation.GetModel().GetName())
	}
	if generation.GetResponseId() != "resp-7" {
		t.Fatalf("unexpected response id: %q", generation.GetResponseId())
	}
	if generation.GetResponseModel() != "gpt-5-2026-03-01" {
		t.Fatalf("unexpected response model: %q", generation.GetResponseModel())
	}
	if generation.GetSystemPrompt() != "You are a concise support assistant." {
		t.Fatalf("unexpected system prompt: %q", generation.GetSystemPrompt())
	}
	if generation.GetStopReason() != "end_turn" {
		t.Fatalf("unexpected stop reason: %q", generation.GetStopReason())
	}
	if !generation.GetStartedAt().AsTime().Equal(startedAt) {
		t.Fatalf("unexpected started_at: got %s want %s", generation.GetStartedAt().AsTime(), startedAt)
	}
	if !generation.GetCompletedAt().AsTime().Equal(completedAt) {
		t.Fatalf("unexpected completed_at: got %s want %s", generation.GetCompletedAt().AsTime(), completedAt)
	}
	if generation.GetMaxTokens() != maxTokens {
		t.Fatalf("unexpected max_tokens: %d", generation.GetMaxTokens())
	}
	if generation.GetTemperature() != temperature {
		t.Fatalf("unexpected temperature: %f", generation.GetTemperature())
	}
	if generation.GetTopP() != topP {
		t.Fatalf("unexpected top_p: %f", generation.GetTopP())
	}
	if generation.GetToolChoice() != toolChoice {
		t.Fatalf("unexpected tool_choice: %q", generation.GetToolChoice())
	}
	if !generation.GetThinkingEnabled() {
		t.Fatalf("expected thinking_enabled=true")
	}

	requireProtoMetadata(t, generation, metadataKeyConversation, "Ticket triage")
	requireProtoMetadata(t, generation, metadataKeyCanonicalUserID, "user-42")
	requireProtoMetadata(t, generation, sdkMetadataKeyName, sdkName)
	requireProtoMetadata(t, generation, "request_id", "req-7")
	requireProtoMetadata(t, generation, "response_format", "text")

	budget, ok := generation.GetMetadata().AsMap()[spanAttrRequestThinkingBudget].(float64)
	if !ok || budget != 4096 {
		t.Fatalf("unexpected thinking budget metadata: %#v", generation.GetMetadata().AsMap()[spanAttrRequestThinkingBudget])
	}

	if len(generation.GetTags()) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(generation.GetTags()))
	}
	if generation.GetTags()["suite"] != "conformance" {
		t.Fatalf("unexpected suite tag: %q", generation.GetTags()["suite"])
	}
	if generation.GetTags()["scenario"] != "full-roundtrip" {
		t.Fatalf("unexpected scenario tag: %q", generation.GetTags()["scenario"])
	}

	if len(generation.GetTools()) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(generation.GetTools()))
	}
	tool := generation.GetTools()[0]
	if tool.GetName() != "lookup_weather" {
		t.Fatalf("unexpected tool name: %q", tool.GetName())
	}
	if tool.GetDescription() != "Look up the latest weather conditions" {
		t.Fatalf("unexpected tool description: %q", tool.GetDescription())
	}
	if tool.GetType() != "function" {
		t.Fatalf("unexpected tool type: %q", tool.GetType())
	}
	if string(tool.GetInputSchemaJson()) != string(toolSchema) {
		t.Fatalf("unexpected tool input schema: %s", tool.GetInputSchemaJson())
	}
	if !tool.GetDeferred() {
		t.Fatalf("expected deferred tool definition")
	}

	if len(generation.GetInput()) != 1 {
		t.Fatalf("expected 1 input message, got %d", len(generation.GetInput()))
	}
	if generation.GetInput()[0].GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_USER {
		t.Fatalf("unexpected input[0] role: %v", generation.GetInput()[0].GetRole())
	}
	if generation.GetInput()[0].GetName() != "customer" {
		t.Fatalf("unexpected input[0] name: %q", generation.GetInput()[0].GetName())
	}
	if got := generation.GetInput()[0].GetParts()[0].GetText(); got != "What's the weather in Paris?" {
		t.Fatalf("unexpected input[0] text: %q", got)
	}

	if len(generation.GetOutput()) != 3 {
		t.Fatalf("expected 3 output messages, got %d", len(generation.GetOutput()))
	}
	if generation.GetOutput()[0].GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT {
		t.Fatalf("unexpected output role: %v", generation.GetOutput()[0].GetRole())
	}
	if got := generation.GetOutput()[0].GetParts()[0].GetThinking(); got != "I have the tool result; compose the final answer." {
		t.Fatalf("unexpected output thinking: %q", got)
	}
	toolCall := generation.GetOutput()[0].GetParts()[1].GetToolCall()
	if toolCall == nil {
		t.Fatalf("expected tool call part in output[0]")
	}
	if toolCall.GetId() != "call-1" || toolCall.GetName() != "lookup_weather" {
		t.Fatalf("unexpected tool call: %#v", toolCall)
	}
	if string(toolCall.GetInputJson()) != string(toolCallInput) {
		t.Fatalf("unexpected tool call input: %s", toolCall.GetInputJson())
	}
	if got := generation.GetOutput()[0].GetParts()[2].GetText(); got != "It is sunny and 22C in Paris." {
		t.Fatalf("unexpected output text: %q", got)
	}
	if generation.GetOutput()[1].GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_TOOL {
		t.Fatalf("unexpected output[1] role: %v", generation.GetOutput()[1].GetRole())
	}
	if generation.GetOutput()[1].GetName() != "lookup_weather" {
		t.Fatalf("unexpected output[1] name: %q", generation.GetOutput()[1].GetName())
	}
	toolResult := generation.GetOutput()[1].GetParts()[0].GetToolResult()
	if toolResult == nil {
		t.Fatalf("expected tool result part in output[1]")
	}
	if toolResult.GetToolCallId() != "call-1" || toolResult.GetName() != "lookup_weather" {
		t.Fatalf("unexpected tool result linkage: %#v", toolResult)
	}
	if toolResult.GetContent() != "sunny, 22C" {
		t.Fatalf("unexpected tool result content: %q", toolResult.GetContent())
	}
	if string(toolResult.GetContentJson()) != string(toolResultContent) {
		t.Fatalf("unexpected tool result json: %s", toolResult.GetContentJson())
	}
	if generation.GetOutput()[2].GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT {
		t.Fatalf("unexpected output[2] role: %v", generation.GetOutput()[2].GetRole())
	}
	if got := generation.GetOutput()[2].GetParts()[0].GetText(); got != "It is sunny and 22C in Paris." {
		t.Fatalf("unexpected final output text: %q", got)
	}

	usage := generation.GetUsage()
	if usage.GetInputTokens() != 120 {
		t.Fatalf("unexpected input tokens: %d", usage.GetInputTokens())
	}
	if usage.GetOutputTokens() != 36 {
		t.Fatalf("unexpected output tokens: %d", usage.GetOutputTokens())
	}
	if usage.GetTotalTokens() != 156 {
		t.Fatalf("unexpected total tokens: %d", usage.GetTotalTokens())
	}
	if usage.GetCacheReadInputTokens() != 5 {
		t.Fatalf("unexpected cache read tokens: %d", usage.GetCacheReadInputTokens())
	}
	if usage.GetCacheWriteInputTokens() != 3 {
		t.Fatalf("unexpected cache write tokens: %d", usage.GetCacheWriteInputTokens())
	}
	if usage.GetReasoningTokens() != 7 {
		t.Fatalf("unexpected reasoning tokens: %d", usage.GetReasoningTokens())
	}
	if generation.GetCallError() != "" {
		t.Fatalf("expected empty call error, got %q", generation.GetCallError())
	}

	if len(generation.GetRawArtifacts()) != 2 {
		t.Fatalf("expected 2 raw artifacts, got %d", len(generation.GetRawArtifacts()))
	}
	if generation.GetRawArtifacts()[0].GetKind() != sigilv1.ArtifactKind_ARTIFACT_KIND_REQUEST {
		t.Fatalf("unexpected first artifact kind: %v", generation.GetRawArtifacts()[0].GetKind())
	}
	if generation.GetRawArtifacts()[0].GetName() != "request" {
		t.Fatalf("unexpected first artifact name: %q", generation.GetRawArtifacts()[0].GetName())
	}
	if generation.GetRawArtifacts()[0].GetContentType() != "application/json" {
		t.Fatalf("unexpected first artifact content type: %q", generation.GetRawArtifacts()[0].GetContentType())
	}
	if string(generation.GetRawArtifacts()[0].GetPayload()) != `{"model":"gpt-5"}` {
		t.Fatalf("unexpected first artifact payload: %s", generation.GetRawArtifacts()[0].GetPayload())
	}
	if generation.GetRawArtifacts()[1].GetKind() != sigilv1.ArtifactKind_ARTIFACT_KIND_RESPONSE {
		t.Fatalf("unexpected second artifact kind: %v", generation.GetRawArtifacts()[1].GetKind())
	}
	if generation.GetRawArtifacts()[1].GetName() != "response" {
		t.Fatalf("unexpected second artifact name: %q", generation.GetRawArtifacts()[1].GetName())
	}
	if string(generation.GetRawArtifacts()[1].GetPayload()) != `{"stop_reason":"end_turn"}` {
		t.Fatalf("unexpected second artifact payload: %s", generation.GetRawArtifacts()[1].GetPayload())
	}
}

func TestConformance_ConversationTitleSemantics(t *testing.T) {
	testCases := []struct {
		name          string
		startTitle    string
		contextTitle  string
		metadataTitle string
		wantTitle     string
	}{
		{
			name:          "explicit wins",
			startTitle:    "Explicit",
			contextTitle:  "Context",
			metadataTitle: "Meta",
			wantTitle:     "Explicit",
		},
		{
			name:         "context fallback",
			contextTitle: "Context",
			wantTitle:    "Context",
		},
		{
			name:          "metadata fallback",
			metadataTitle: "Meta",
			wantTitle:     "Meta",
		},
		{
			name:       "whitespace omitted",
			startTitle: "  ",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			env := newConformanceEnv(t)

			ctx := context.Background()
			if tc.contextTitle != "" {
				ctx = sigil.WithConversationTitle(ctx, tc.contextTitle)
			}

			start := sigil.GenerationStart{
				Model:             conformanceModel,
				ConversationTitle: tc.startTitle,
			}
			if tc.metadataTitle != "" {
				start.Metadata = map[string]any{
					metadataKeyConversation: tc.metadataTitle,
				}
			}

			recordGeneration(t, env, ctx, start, sigil.Generation{})

			span := findSpan(t, env.Spans.Ended(), conformanceOperationName)
			attrs := spanAttrs(span)
			if tc.wantTitle == "" {
				requireSpanAttrAbsent(t, attrs, spanAttrConversationTitle)
			} else {
				requireSpanAttr(t, attrs, spanAttrConversationTitle, tc.wantTitle)
			}

			requireSyncGenerationMetrics(t, env)
			env.Shutdown(t)

			generation := env.Ingest.SingleGeneration(t)
			if tc.wantTitle == "" {
				requireProtoMetadataAbsent(t, generation, metadataKeyConversation)
			} else {
				requireProtoMetadata(t, generation, metadataKeyConversation, tc.wantTitle)
			}
		})
	}
}

func TestConformance_UserIDSemantics(t *testing.T) {
	testCases := []struct {
		name           string
		startUserID    string
		contextUserID  string
		canonicalUser  string
		legacyUser     string
		wantResolvedID string
	}{
		{
			name:           "explicit wins",
			startUserID:    "explicit",
			contextUserID:  "ctx",
			canonicalUser:  "meta-canonical",
			legacyUser:     "meta-legacy",
			wantResolvedID: "explicit",
		},
		{
			name:           "context fallback",
			contextUserID:  "ctx",
			wantResolvedID: "ctx",
		},
		{
			name:           "canonical metadata",
			canonicalUser:  "canonical",
			wantResolvedID: "canonical",
		},
		{
			name:           "legacy metadata",
			legacyUser:     "legacy",
			wantResolvedID: "legacy",
		},
		{
			name:           "canonical beats legacy",
			canonicalUser:  "canonical",
			legacyUser:     "legacy",
			wantResolvedID: "canonical",
		},
		{
			name:           "whitespace trimmed",
			startUserID:    "  padded  ",
			wantResolvedID: "padded",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			env := newConformanceEnv(t)

			ctx := context.Background()
			if tc.contextUserID != "" {
				ctx = sigil.WithUserID(ctx, tc.contextUserID)
			}

			start := sigil.GenerationStart{
				Model:  conformanceModel,
				UserID: tc.startUserID,
			}
			if tc.canonicalUser != "" || tc.legacyUser != "" {
				start.Metadata = map[string]any{}
				if tc.canonicalUser != "" {
					start.Metadata[metadataKeyCanonicalUserID] = tc.canonicalUser
				}
				if tc.legacyUser != "" {
					start.Metadata[metadataKeyLegacyUserID] = tc.legacyUser
				}
			}

			recordGeneration(t, env, ctx, start, sigil.Generation{})

			span := findSpan(t, env.Spans.Ended(), conformanceOperationName)
			attrs := spanAttrs(span)
			requireSpanAttr(t, attrs, spanAttrUserID, tc.wantResolvedID)

			requireSyncGenerationMetrics(t, env)
			env.Shutdown(t)

			generation := env.Ingest.SingleGeneration(t)
			requireProtoMetadata(t, generation, metadataKeyCanonicalUserID, tc.wantResolvedID)
		})
	}
}

func TestConformance_AgentIdentitySemantics(t *testing.T) {
	testCases := []struct {
		name             string
		startAgentName   string
		startVersion     string
		contextAgentName string
		contextVersion   string
		resultAgentName  string
		resultVersion    string
		wantAgentName    string
		wantVersion      string
	}{
		{
			name:           "explicit fields",
			startAgentName: "agent-explicit",
			startVersion:   "v1.2.3",
			wantAgentName:  "agent-explicit",
			wantVersion:    "v1.2.3",
		},
		{
			name:             "context fallback",
			contextAgentName: "agent-context",
			contextVersion:   "v-context",
			wantAgentName:    "agent-context",
			wantVersion:      "v-context",
		},
		{
			name:            "result-time override",
			startAgentName:  "agent-seed",
			startVersion:    "v-seed",
			resultAgentName: "agent-result",
			resultVersion:   "v-result",
			wantAgentName:   "agent-result",
			wantVersion:     "v-result",
		},
		{
			name: "empty field omission",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			env := newConformanceEnv(t)

			ctx := context.Background()
			if tc.contextAgentName != "" {
				ctx = sigil.WithAgentName(ctx, tc.contextAgentName)
			}
			if tc.contextVersion != "" {
				ctx = sigil.WithAgentVersion(ctx, tc.contextVersion)
			}

			start := sigil.GenerationStart{
				Model:        conformanceModel,
				AgentName:    tc.startAgentName,
				AgentVersion: tc.startVersion,
			}
			result := sigil.Generation{
				AgentName:    tc.resultAgentName,
				AgentVersion: tc.resultVersion,
			}

			recordGeneration(t, env, ctx, start, result)

			span := findSpan(t, env.Spans.Ended(), conformanceOperationName)
			attrs := spanAttrs(span)
			if tc.wantAgentName == "" {
				requireSpanAttrAbsent(t, attrs, spanAttrAgentName)
			} else {
				requireSpanAttr(t, attrs, spanAttrAgentName, tc.wantAgentName)
			}
			if tc.wantVersion == "" {
				requireSpanAttrAbsent(t, attrs, spanAttrAgentVersion)
			} else {
				requireSpanAttr(t, attrs, spanAttrAgentVersion, tc.wantVersion)
			}

			requireSyncGenerationMetrics(t, env)
			env.Shutdown(t)

			generation := env.Ingest.SingleGeneration(t)
			if tc.wantAgentName == "" {
				if got := generation.GetAgentName(); got != "" {
					t.Fatalf("expected empty proto agent_name, got %q", got)
				}
			} else if got := generation.GetAgentName(); got != tc.wantAgentName {
				t.Fatalf("unexpected proto agent_name: got %q want %q", got, tc.wantAgentName)
			}

			if tc.wantVersion == "" {
				if got := generation.GetAgentVersion(); got != "" {
					t.Fatalf("expected empty proto agent_version, got %q", got)
				}
			} else if got := generation.GetAgentVersion(); got != tc.wantVersion {
				t.Fatalf("unexpected proto agent_version: got %q want %q", got, tc.wantVersion)
			}
		})
	}
}

func recordGeneration(t *testing.T, env *conformanceEnv, ctx context.Context, start sigil.GenerationStart, result sigil.Generation) {
	t.Helper()

	_, recorder := env.Client.StartGeneration(ctx, start)
	recorder.SetResult(result, nil)
	recorder.End()
	if err := recorder.Err(); err != nil {
		t.Fatalf("record generation: %v", err)
	}
}

func requireSyncGenerationMetrics(t *testing.T, env *conformanceEnv) {
	t.Helper()

	metrics := env.CollectMetrics(t)
	duration := findHistogram[float64](t, metrics, metricOperationDuration)
	if len(duration.DataPoints) == 0 {
		t.Fatalf("expected %s datapoints for conformance generation", metricOperationDuration)
	}
	requireNoHistogram(t, metrics, metricTimeToFirstToken)
}
