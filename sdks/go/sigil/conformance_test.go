package sigil_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	sigil "github.com/grafana/sigil/sdks/go/sigil"
	sigilv1 "github.com/grafana/sigil/sdks/go/sigil/internal/gen/sigil/v1"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

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

func TestConformance_StreamingMode(t *testing.T) {
	env := newConformanceEnv(t)

	recordGeneration(t, env, context.Background(), sigil.GenerationStart{
		ConversationID: "conv-sync",
		Model:          conformanceModel,
		StartedAt:      time.Date(2026, 3, 12, 14, 0, 0, 0, time.UTC),
	}, sigil.Generation{
		Input:       []sigil.Message{sigil.UserTextMessage("hello")},
		Output:      []sigil.Message{sigil.AssistantTextMessage("hi")},
		CompletedAt: time.Date(2026, 3, 12, 14, 0, 1, 0, time.UTC),
	})

	streamStartedAt := time.Date(2026, 3, 12, 14, 1, 0, 0, time.UTC)
	_, recorder := env.Client.StartStreamingGeneration(context.Background(), sigil.GenerationStart{
		ConversationID: "conv-stream",
		AgentName:      "agent-stream",
		Model:          conformanceModel,
		StartedAt:      streamStartedAt,
	})
	recorder.SetFirstTokenAt(streamStartedAt.Add(250 * time.Millisecond))
	recorder.SetResult(sigil.Generation{
		Input:       []sigil.Message{sigil.UserTextMessage("say hello")},
		Output:      []sigil.Message{sigil.AssistantTextMessage("Hello world")},
		CompletedAt: streamStartedAt.Add(1500 * time.Millisecond),
	}, nil)
	recorder.End()
	if err := recorder.Err(); err != nil {
		t.Fatalf("record streaming generation: %v", err)
	}

	metrics := env.CollectMetrics(t)
	ttft := findHistogram[float64](t, metrics, metricTimeToFirstToken)
	if len(ttft.DataPoints) != 1 {
		t.Fatalf("expected exactly 1 %s datapoint, got %d", metricTimeToFirstToken, len(ttft.DataPoints))
	}
	requireHistogramPointWithAttrs(t, ttft, map[string]string{
		spanAttrProviderName: conformanceModel.Provider,
		spanAttrRequestModel: conformanceModel.Name,
		spanAttrAgentName:    "agent-stream",
	})

	env.Shutdown(t)

	streamGeneration := findGenerationByConversationID(t, env.Ingest.Requests(), "conv-stream")
	if got := streamGeneration.GetMode(); got != sigilv1.GenerationMode_GENERATION_MODE_STREAM {
		t.Fatalf("unexpected proto mode: got %v want %v", got, sigilv1.GenerationMode_GENERATION_MODE_STREAM)
	}

	span := findSpan(t, env.Spans.Ended(), conformanceStreamOperation)
	attrs := spanAttrs(span)
	requireSpanAttr(t, attrs, spanAttrOperationName, conformanceStreamOperation)
}

func TestConformance_ToolExecution(t *testing.T) {
	env := newConformanceEnv(t)

	ctx := sigil.WithConversationID(context.Background(), "conv-tool")
	ctx = sigil.WithConversationTitle(ctx, "Weather lookup")
	ctx = sigil.WithAgentName(ctx, "agent-tools")
	ctx = sigil.WithAgentVersion(ctx, "2026.03.12")

	generationStartedAt := time.Date(2026, 3, 12, 14, 2, 0, 0, time.UTC)
	callCtx, generationRecorder := env.Client.StartGeneration(ctx, sigil.GenerationStart{
		Model:     conformanceModel,
		StartedAt: generationStartedAt,
	})
	_, toolRecorder := env.Client.StartToolExecution(callCtx, sigil.ToolExecutionStart{
		ToolName:        "weather",
		ToolCallID:      "call-weather",
		ToolType:        "function",
		ToolDescription: "Get weather",
		IncludeContent:  true,
		StartedAt:       generationStartedAt.Add(100 * time.Millisecond),
	})
	toolRecorder.SetResult(sigil.ToolExecutionEnd{
		Arguments:   map[string]any{"city": "Paris"},
		Result:      map[string]any{"temp_c": 18},
		CompletedAt: generationStartedAt.Add(600 * time.Millisecond),
	})
	toolRecorder.End()
	if err := toolRecorder.Err(); err != nil {
		t.Fatalf("record tool execution: %v", err)
	}

	generationRecorder.SetResult(sigil.Generation{
		Input:       []sigil.Message{sigil.UserTextMessage("weather in Paris")},
		Output:      []sigil.Message{sigil.AssistantTextMessage("Paris is 18C")},
		CompletedAt: generationStartedAt.Add(time.Second),
	}, nil)
	generationRecorder.End()
	if err := generationRecorder.Err(); err != nil {
		t.Fatalf("record parent generation: %v", err)
	}

	metrics := env.CollectMetrics(t)
	duration := findHistogram[float64](t, metrics, metricOperationDuration)
	requireHistogramPointWithAttrs(t, duration, map[string]string{
		spanAttrOperationName: conformanceToolOperation,
		spanAttrRequestModel:  "weather",
		spanAttrAgentName:     "agent-tools",
	})

	env.Shutdown(t)

	span := findSpan(t, env.Spans.Ended(), conformanceToolOperation)
	if got := span.SpanKind(); got != trace.SpanKindInternal {
		t.Fatalf("unexpected tool span kind: got %v want %v", got, trace.SpanKindInternal)
	}

	attrs := spanAttrs(span)
	requireSpanAttr(t, attrs, spanAttrOperationName, conformanceToolOperation)
	requireSpanAttr(t, attrs, spanAttrToolName, "weather")
	requireSpanAttr(t, attrs, spanAttrToolCallID, "call-weather")
	requireSpanAttr(t, attrs, spanAttrToolType, "function")
	requireSpanAttr(t, attrs, spanAttrToolDescription, "Get weather")
	requireSpanAttr(t, attrs, spanAttrConversationID, "conv-tool")
	requireSpanAttr(t, attrs, spanAttrConversationTitle, "Weather lookup")
	requireSpanAttr(t, attrs, spanAttrAgentName, "agent-tools")
	requireSpanAttr(t, attrs, spanAttrAgentVersion, "2026.03.12")
	requireSpanAttr(t, attrs, sdkMetadataKeyName, sdkName)
	requireSpanAttrPresent(t, attrs, spanAttrToolCallArguments)
	requireSpanAttrPresent(t, attrs, spanAttrToolCallResult)
}

func TestConformance_Embedding(t *testing.T) {
	env := newConformanceEnv(t)

	_, recorder := env.Client.StartEmbedding(context.Background(), sigil.EmbeddingStart{
		Model:          sigil.ModelRef{Provider: "openai", Name: "text-embedding-3-small"},
		AgentName:      "agent-embed",
		Dimensions:     int64Ptr(256),
		EncodingFormat: "float",
		StartedAt:      time.Date(2026, 3, 12, 14, 3, 0, 0, time.UTC),
	})
	recorder.SetResult(sigil.EmbeddingResult{
		InputCount:    2,
		InputTokens:   120,
		ResponseModel: "text-embedding-3-small",
		Dimensions:    int64Ptr(256),
	})
	recorder.End()
	if err := recorder.Err(); err != nil {
		t.Fatalf("record embedding: %v", err)
	}

	metrics := env.CollectMetrics(t)
	duration := findHistogram[float64](t, metrics, metricOperationDuration)
	requireHistogramPointWithAttrs(t, duration, map[string]string{
		spanAttrOperationName: conformanceEmbeddingOperation,
		spanAttrProviderName:  "openai",
		spanAttrRequestModel:  "text-embedding-3-small",
		spanAttrAgentName:     "agent-embed",
	})
	tokenUsage := findHistogram[int64](t, metrics, metricTokenUsage)
	requireHistogramPointWithAttrs(t, tokenUsage, map[string]string{
		spanAttrOperationName: conformanceEmbeddingOperation,
		spanAttrProviderName:  "openai",
		spanAttrRequestModel:  "text-embedding-3-small",
		spanAttrAgentName:     "agent-embed",
		metricAttrTokenType:   metricTokenTypeInput,
	})

	env.Shutdown(t)

	if got := env.Ingest.GenerationCount(); got != 0 {
		t.Fatalf("expected no generation exports for embeddings, got %d", got)
	}

	span := findSpan(t, env.Spans.Ended(), conformanceEmbeddingOperation)
	if got := span.SpanKind(); got != trace.SpanKindClient {
		t.Fatalf("unexpected embedding span kind: got %v want %v", got, trace.SpanKindClient)
	}

	attrs := spanAttrs(span)
	requireSpanAttr(t, attrs, spanAttrOperationName, conformanceEmbeddingOperation)
	requireSpanAttr(t, attrs, spanAttrProviderName, "openai")
	requireSpanAttr(t, attrs, spanAttrRequestModel, "text-embedding-3-small")
	requireSpanAttr(t, attrs, sdkMetadataKeyName, sdkName)
	if got := attrs[spanAttrEmbeddingInputCount].AsInt64(); got != 2 {
		t.Fatalf("unexpected embedding input count: got %d want 2", got)
	}
	if got := attrs[spanAttrEmbeddingDimCount].AsInt64(); got != 256 {
		t.Fatalf("unexpected embedding dimension count: got %d want 256", got)
	}
}

func TestConformance_ValidationAndErrorSemantics(t *testing.T) {
	t.Run("invalid generation", func(t *testing.T) {
		env := newConformanceEnv(t)

		_, recorder := env.Client.StartGeneration(context.Background(), sigil.GenerationStart{
			ConversationID: "conv-invalid",
			StartedAt:      time.Date(2026, 3, 12, 14, 4, 0, 0, time.UTC),
		})
		recorder.SetResult(sigil.Generation{
			Input:       []sigil.Message{sigil.UserTextMessage("hello")},
			Output:      []sigil.Message{sigil.AssistantTextMessage("hi")},
			CompletedAt: time.Date(2026, 3, 12, 14, 4, 1, 0, time.UTC),
		}, nil)
		recorder.End()

		if err := recorder.Err(); !errors.Is(err, sigil.ErrValidationFailed) {
			t.Fatalf("expected ErrValidationFailed, got %v", err)
		}
		if got := env.Ingest.GenerationCount(); got != 0 {
			t.Fatalf("expected no exports for invalid generation, got %d", got)
		}

		span := findSpan(t, env.Spans.Ended(), conformanceOperationName)
		if got := span.Status().Code; got != codes.Error {
			t.Fatalf("expected error span status, got %v", got)
		}
		attrs := spanAttrs(span)
		requireSpanAttr(t, attrs, spanAttrErrorType, "validation_error")
	})

	t.Run("provider call error", func(t *testing.T) {
		env := newConformanceEnv(t)

		_, recorder := env.Client.StartGeneration(context.Background(), sigil.GenerationStart{
			ConversationID: "conv-rate-limit",
			AgentName:      "agent-error",
			Model:          conformanceModel,
			StartedAt:      time.Date(2026, 3, 12, 14, 5, 0, 0, time.UTC),
		})
		recorder.SetCallError(errors.New("provider returned HTTP 429 rate limit"))
		recorder.SetResult(sigil.Generation{
			Input:       []sigil.Message{sigil.UserTextMessage("retry later")},
			Output:      []sigil.Message{sigil.AssistantTextMessage("rate limited")},
			CompletedAt: time.Date(2026, 3, 12, 14, 5, 1, 0, time.UTC),
		}, nil)
		recorder.End()
		if err := recorder.Err(); err != nil {
			t.Fatalf("expected no local error for provider call failure, got %v", err)
		}

		metrics := env.CollectMetrics(t)
		duration := findHistogram[float64](t, metrics, metricOperationDuration)
		requireHistogramPointWithAttrs(t, duration, map[string]string{
			spanAttrOperationName: conformanceOperationName,
			spanAttrProviderName:  conformanceModel.Provider,
			spanAttrRequestModel:  conformanceModel.Name,
			spanAttrAgentName:     "agent-error",
			spanAttrErrorType:     "provider_call_error",
			spanAttrErrorCategory: "rate_limit",
		})

		env.Shutdown(t)

		span := findSpan(t, env.Spans.Ended(), conformanceOperationName)
		if got := span.Status().Code; got != codes.Error {
			t.Fatalf("expected error span status, got %v", got)
		}
		attrs := spanAttrs(span)
		requireSpanAttr(t, attrs, spanAttrErrorType, "provider_call_error")
		requireSpanAttr(t, attrs, spanAttrErrorCategory, "rate_limit")
	})
}

func TestConformance_RatingHelper(t *testing.T) {
	env := newConformanceEnv(t, withConformanceConfig(func(cfg *sigil.Config) {
		cfg.GenerationExport.Headers = map[string]string{"X-Custom": "test"}
	}))

	response, err := env.Client.SubmitConversationRating(context.Background(), "conv-rated", sigil.ConversationRatingInput{
		RatingID: "rat-1",
		Rating:   sigil.ConversationRatingValueGood,
		Comment:  "looks good",
		Metadata: map[string]any{"channel": "assistant"},
	})
	if err != nil {
		t.Fatalf("submit conversation rating: %v", err)
	}

	requests := env.Rating.Requests()
	if len(requests) != 1 {
		t.Fatalf("expected exactly 1 rating request, got %d", len(requests))
	}

	request := requests[0]
	if request.Method != http.MethodPost {
		t.Fatalf("unexpected request method: got %s want %s", request.Method, http.MethodPost)
	}
	if request.Path != "/api/v1/conversations/conv-rated/ratings" {
		t.Fatalf("unexpected rating request path: %s", request.Path)
	}
	if got := request.Headers.Get("X-Custom"); got != "test" {
		t.Fatalf("expected X-Custom header, got %q", got)
	}

	var payload sigil.ConversationRatingInput
	if err := json.Unmarshal(request.Body, &payload); err != nil {
		t.Fatalf("decode rating request body: %v", err)
	}
	if payload.RatingID != "rat-1" {
		t.Fatalf("unexpected rating id: %q", payload.RatingID)
	}
	if payload.Rating != sigil.ConversationRatingValueGood {
		t.Fatalf("unexpected rating value: %q", payload.Rating)
	}
	if payload.Comment != "looks good" {
		t.Fatalf("unexpected comment: %q", payload.Comment)
	}
	if got := payload.Metadata["channel"]; got != "assistant" {
		t.Fatalf("unexpected metadata: %#v", payload.Metadata)
	}
	if response == nil || response.Rating.RatingID != "rat-1" {
		t.Fatalf("unexpected rating response: %#v", response)
	}
}

func TestConformance_ShutdownFlushesPendingGeneration(t *testing.T) {
	env := newConformanceEnv(t, withConformanceConfig(func(cfg *sigil.Config) {
		cfg.GenerationExport.BatchSize = 10
	}))

	recordGeneration(t, env, context.Background(), sigil.GenerationStart{
		ConversationID: "conv-shutdown",
		Model:          conformanceModel,
		StartedAt:      time.Date(2026, 3, 12, 14, 6, 0, 0, time.UTC),
	}, sigil.Generation{
		Input:       []sigil.Message{sigil.UserTextMessage("hello")},
		Output:      []sigil.Message{sigil.AssistantTextMessage("hi")},
		CompletedAt: time.Date(2026, 3, 12, 14, 6, 1, 0, time.UTC),
	})

	if got := env.Ingest.GenerationCount(); got != 0 {
		t.Fatalf("expected no exports before shutdown flush, got %d", got)
	}

	env.Shutdown(t)

	if got := env.Ingest.GenerationCount(); got != 1 {
		t.Fatalf("expected exactly 1 exported generation after shutdown, got %d", got)
	}
	generation := env.Ingest.SingleGeneration(t)
	if got := generation.GetConversationId(); got != "conv-shutdown" {
		t.Fatalf("unexpected shutdown-flushed conversation id: %q", got)
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

func findGenerationByConversationID(t *testing.T, requests []*sigilv1.ExportGenerationsRequest, conversationID string) *sigilv1.Generation {
	t.Helper()

	for _, req := range requests {
		for _, generation := range req.GetGenerations() {
			if generation.GetConversationId() == conversationID {
				return generation
			}
		}
	}

	t.Fatalf("expected generation for conversation %q", conversationID)
	return nil
}

func int64Ptr(value int64) *int64 {
	return &value
}
