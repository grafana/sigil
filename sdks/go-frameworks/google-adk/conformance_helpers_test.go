package googleadk_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/grafana/sigil/sdks/go/sigil"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

const (
	frameworkNameAttr     = "sigil.framework.name"
	frameworkSourceAttr   = "sigil.framework.source"
	frameworkLanguageAttr = "sigil.framework.language"
	frameworkRunIDAttr    = "sigil.framework.run_id"
	frameworkThreadIDAttr = "sigil.framework.thread_id"
	frameworkParentRunID  = "sigil.framework.parent_run_id"
	frameworkComponent    = "sigil.framework.component_name"
	frameworkRunType      = "sigil.framework.run_type"
	frameworkTagsAttr     = "sigil.framework.tags"
	frameworkRetryAttr    = "sigil.framework.retry_attempt"
	frameworkEventIDAttr  = "sigil.framework.event_id"
	operationNameAttr     = "gen_ai.operation.name"
)

type conformanceEnv struct {
	Client         *sigil.Client
	Ingest         *generationCaptureServer
	Spans          *tracetest.SpanRecorder
	tracerProvider *sdktrace.TracerProvider
}

func newConformanceEnv(t *testing.T) *conformanceEnv {
	t.Helper()

	ingest := newGenerationCaptureServer(t)
	spanRecorder := tracetest.NewSpanRecorder()
	tracerProvider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spanRecorder))

	cfg := sigil.DefaultConfig()
	cfg.Tracer = tracerProvider.Tracer("google-adk-conformance-test")
	cfg.GenerationExport.Protocol = sigil.GenerationExportProtocolHTTP
	cfg.GenerationExport.Endpoint = ingest.server.URL + "/api/v1/generations:export"
	cfg.GenerationExport.BatchSize = 1
	cfg.GenerationExport.QueueSize = 8
	cfg.GenerationExport.FlushInterval = time.Hour
	cfg.GenerationExport.MaxRetries = 1
	cfg.GenerationExport.InitialBackoff = time.Millisecond
	cfg.GenerationExport.MaxBackoff = 5 * time.Millisecond
	cfg.GenerationExport.PayloadMaxBytes = 4 << 20

	env := &conformanceEnv{
		Client:         sigil.NewClient(cfg),
		Ingest:         ingest,
		Spans:          spanRecorder,
		tracerProvider: tracerProvider,
	}
	t.Cleanup(func() {
		_ = env.close()
	})
	return env
}

func (e *conformanceEnv) Shutdown(t *testing.T) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := e.Client.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown conformance client: %v", err)
	}
}

func (e *conformanceEnv) close() error {
	if e == nil {
		return nil
	}

	var closeErr error
	if e.Client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := e.Client.Shutdown(ctx); err != nil {
			closeErr = err
		}
	}
	if e.tracerProvider != nil {
		if err := e.tracerProvider.Shutdown(context.Background()); err != nil && closeErr == nil {
			closeErr = err
		}
	}
	if e.Ingest != nil {
		e.Ingest.server.Close()
	}
	return closeErr
}

type generationCaptureServer struct {
	server   *httptest.Server
	mu       sync.Mutex
	requests []exportRequest
}

type exportRequest struct {
	Generations []map[string]any `json:"generations"`
}

func newGenerationCaptureServer(t *testing.T) *generationCaptureServer {
	t.Helper()

	capture := &generationCaptureServer{}
	capture.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}

		var request exportRequest
		if err := json.Unmarshal(body, &request); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}

		capture.mu.Lock()
		capture.requests = append(capture.requests, request)
		capture.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	return capture
}

func (c *generationCaptureServer) SingleGeneration(t *testing.T) map[string]any {
	t.Helper()

	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.requests) != 1 {
		t.Fatalf("expected exactly one export request, got %d", len(c.requests))
	}
	if len(c.requests[0].Generations) != 1 {
		t.Fatalf("expected exactly one generation in request, got %d", len(c.requests[0].Generations))
	}
	return c.requests[0].Generations[0]
}

func findGenerationSpan(t *testing.T, spans []sdktrace.ReadOnlySpan, operation string) sdktrace.ReadOnlySpan {
	t.Helper()

	var matched sdktrace.ReadOnlySpan
	for _, span := range spans {
		attrs := spanAttrs(span)
		gotOperation, ok := attrs[operationNameAttr]
		if !ok || gotOperation.AsString() != operation {
			continue
		}
		if matched != nil {
			t.Fatalf("expected exactly one generation span with %s=%q", operationNameAttr, operation)
		}
		matched = span
	}
	if matched == nil {
		t.Fatalf("expected generation span with %s=%q", operationNameAttr, operation)
	}
	return matched
}

func spanAttrs(span sdktrace.ReadOnlySpan) map[string]attribute.Value {
	attrs := make(map[string]attribute.Value, len(span.Attributes()))
	for _, attr := range span.Attributes() {
		attrs[string(attr.Key)] = attr.Value
	}
	return attrs
}

func requireSpanAttrString(t *testing.T, attrs map[string]attribute.Value, key, want string) {
	t.Helper()

	got, ok := attrs[key]
	if !ok {
		t.Fatalf("expected span attribute %q=%q, attribute missing", key, want)
	}
	if got.AsString() != want {
		t.Fatalf("unexpected span attribute %q: got %q want %q", key, got.AsString(), want)
	}
}

func requireSpanAttrInt(t *testing.T, attrs map[string]attribute.Value, key string, want int64) {
	t.Helper()

	got, ok := attrs[key]
	if !ok {
		t.Fatalf("expected span attribute %q=%d, attribute missing", key, want)
	}
	if got.AsInt64() != want {
		t.Fatalf("unexpected span attribute %q: got %d want %d", key, got.AsInt64(), want)
	}
}

func requireSpanAttrStringSlice(t *testing.T, attrs map[string]attribute.Value, key string, want []string) {
	t.Helper()

	got, ok := attrs[key]
	if !ok {
		t.Fatalf("expected span attribute %q=%v, attribute missing", key, want)
	}
	if len(got.AsStringSlice()) != len(want) {
		t.Fatalf("unexpected span attribute %q length: got %v want %v", key, got.AsStringSlice(), want)
	}
	for i, item := range got.AsStringSlice() {
		if item != want[i] {
			t.Fatalf("unexpected span attribute %q[%d]: got %q want %q", key, i, item, want[i])
		}
	}
}

func requireGenerationTag(t *testing.T, generation map[string]any, key, want string) {
	t.Helper()

	rawTags, ok := generation["tags"]
	if !ok {
		t.Fatalf("expected generation tags to contain %q=%q, tags missing", key, want)
	}
	tags, ok := rawTags.(map[string]any)
	if !ok {
		t.Fatalf("expected generation tags to be object, got %T", rawTags)
	}
	gotRaw, ok := tags[key]
	if !ok {
		t.Fatalf("expected generation tag %q=%q, tag missing", key, want)
	}
	got, ok := gotRaw.(string)
	if !ok {
		t.Fatalf("expected generation tag %q to be string, got %T", key, gotRaw)
	}
	if got != want {
		t.Fatalf("unexpected generation tag %q: got %q want %q", key, got, want)
	}
}

func requireGenerationMetadataString(t *testing.T, generation map[string]any, key, want string) {
	t.Helper()

	rawMetadata, ok := generation["metadata"]
	if !ok {
		t.Fatalf("expected generation metadata to contain %q=%q, metadata missing", key, want)
	}
	metadata, ok := rawMetadata.(map[string]any)
	if !ok {
		t.Fatalf("expected generation metadata to be object, got %T", rawMetadata)
	}
	got, ok := metadata[key]
	if !ok {
		t.Fatalf("expected generation metadata %q=%q, key missing", key, want)
	}
	asString, ok := got.(string)
	if !ok {
		t.Fatalf("expected generation metadata %q to be string, got %T", key, got)
	}
	if asString != want {
		t.Fatalf("unexpected generation metadata %q: got %q want %q", key, asString, want)
	}
}

func requireGenerationMetadataInt(t *testing.T, generation map[string]any, key string, want int64) {
	t.Helper()

	rawMetadata, ok := generation["metadata"]
	if !ok {
		t.Fatalf("expected generation metadata to contain %q=%d, metadata missing", key, want)
	}
	metadata, ok := rawMetadata.(map[string]any)
	if !ok {
		t.Fatalf("expected generation metadata to be object, got %T", rawMetadata)
	}
	got, ok := metadata[key]
	if !ok {
		t.Fatalf("expected generation metadata %q=%d, key missing", key, want)
	}
	switch typed := got.(type) {
	case float64:
		if int64(typed) != want {
			t.Fatalf("unexpected generation metadata %q: got %v want %d", key, got, want)
		}
	case int:
		if int64(typed) != want {
			t.Fatalf("unexpected generation metadata %q: got %v want %d", key, got, want)
		}
	case int64:
		if typed != want {
			t.Fatalf("unexpected generation metadata %q: got %v want %d", key, got, want)
		}
	default:
		t.Fatalf("expected generation metadata %q to be numeric, got %T", key, got)
	}
}

func requireGenerationMetadataStrings(t *testing.T, generation map[string]any, key string, want []string) {
	t.Helper()

	rawMetadata, ok := generation["metadata"]
	if !ok {
		t.Fatalf("expected generation metadata to contain %q=%v, metadata missing", key, want)
	}
	metadata, ok := rawMetadata.(map[string]any)
	if !ok {
		t.Fatalf("expected generation metadata to be object, got %T", rawMetadata)
	}
	got, ok := metadata[key]
	if !ok {
		t.Fatalf("expected generation metadata %q=%v, key missing", key, want)
	}
	items, ok := got.([]any)
	if !ok {
		t.Fatalf("expected generation metadata %q to be []any, got %T", key, got)
	}
	if len(items) != len(want) {
		t.Fatalf("unexpected generation metadata %q length: got %v want %v", key, items, want)
	}
	for i, item := range items {
		asString, ok := item.(string)
		if !ok {
			t.Fatalf("expected generation metadata %q[%d] to be string, got %T", key, i, item)
		}
		if asString != want[i] {
			t.Fatalf("unexpected generation metadata %q[%d]: got %q want %q", key, i, asString, want[i])
		}
	}
}

func requireGenerationFieldString(t *testing.T, generation map[string]any, key, want string) {
	t.Helper()

	got, ok := generation[key]
	if !ok {
		t.Fatalf("expected generation field %q=%q, field missing", key, want)
	}
	asString, ok := got.(string)
	if !ok {
		t.Fatalf("expected generation field %q to be string, got %T", key, got)
	}
	if asString != want {
		t.Fatalf("unexpected generation field %q: got %q want %q", key, asString, want)
	}
}

func requireGenerationFieldMapString(t *testing.T, generation map[string]any, field, key, want string) {
	t.Helper()

	rawMap, ok := generation[field]
	if !ok {
		t.Fatalf("expected generation field %q to contain %q=%q, field missing", field, key, want)
	}
	typedMap, ok := rawMap.(map[string]any)
	if !ok {
		t.Fatalf("expected generation field %q to be object, got %T", field, rawMap)
	}
	rawValue, ok := typedMap[key]
	if !ok {
		t.Fatalf("expected generation field %q.%s=%q, key missing", field, key, want)
	}
	asString, ok := rawValue.(string)
	if !ok {
		t.Fatalf("expected generation field %q.%s to be string, got %T", field, key, rawValue)
	}
	if asString != want {
		t.Fatalf("unexpected generation field %q.%s: got %q want %q", field, key, asString, want)
	}
}

func requireGenerationFieldInt(t *testing.T, generation map[string]any, field string, want int64) {
	t.Helper()

	raw, ok := generation[field]
	if !ok {
		t.Fatalf("expected generation field %q=%d, field missing", field, want)
	}
	switch typed := raw.(type) {
	case float64:
		if int64(typed) != want {
			t.Fatalf("unexpected generation field %q: got %v want %d", field, raw, want)
		}
	case int:
		if int64(typed) != want {
			t.Fatalf("unexpected generation field %q: got %v want %d", field, raw, want)
		}
	default:
		t.Fatalf("expected generation field %q to be numeric, got %T", field, raw)
	}
}

func requireGenerationUsageInt(t *testing.T, generation map[string]any, key string, want int64) {
	t.Helper()

	rawUsage, ok := generation["usage"]
	if !ok {
		t.Fatalf("expected generation usage.%s=%d, usage missing", key, want)
	}
	usage, ok := rawUsage.(map[string]any)
	if !ok {
		t.Fatalf("expected generation usage to be object, got %T", rawUsage)
	}
	raw, ok := usage[key]
	if !ok {
		t.Fatalf("expected generation usage.%s=%d, key missing", key, want)
	}
	switch typed := raw.(type) {
	case float64:
		if int64(typed) != want {
			t.Fatalf("unexpected generation usage.%s: got %v want %d", key, raw, want)
		}
	case string:
		asInt, err := strconv.ParseInt(typed, 10, 64)
		if err != nil {
			t.Fatalf("expected generation usage.%s string to parse as int64, got %q", key, typed)
		}
		if asInt != want {
			t.Fatalf("unexpected generation usage.%s: got %v want %d", key, raw, want)
		}
	default:
		t.Fatalf("expected generation usage.%s to be numeric, got %T", key, raw)
	}
}

func requireGenerationMessageText(t *testing.T, generation map[string]any, field string, want string) {
	t.Helper()

	rawMessages, ok := generation[field]
	if !ok {
		t.Fatalf("expected generation field %q to contain a message with %q, field missing", field, want)
	}
	messages, ok := rawMessages.([]any)
	if !ok || len(messages) != 1 {
		t.Fatalf("expected generation field %q to contain exactly one message, got %#v", field, rawMessages)
	}
	message, ok := messages[0].(map[string]any)
	if !ok {
		t.Fatalf("expected generation %q[0] to be object, got %T", field, messages[0])
	}
	rawParts, ok := message["parts"]
	if !ok {
		t.Fatalf("expected generation %q[0] to contain parts", field)
	}
	parts, ok := rawParts.([]any)
	if !ok || len(parts) != 1 {
		t.Fatalf("expected generation %q[0].parts to contain exactly one part, got %#v", field, rawParts)
	}
	part, ok := parts[0].(map[string]any)
	if !ok {
		t.Fatalf("expected generation %q[0].parts[0] to be object, got %T", field, parts[0])
	}
	text, ok := part["text"].(string)
	if !ok {
		t.Fatalf("expected generation %q[0].parts[0].text to be string, got %#v", field, part["text"])
	}
	if text != want {
		t.Fatalf("unexpected generation %q[0].parts[0].text: got %q want %q", field, text, want)
	}
}
