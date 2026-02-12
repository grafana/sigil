package generation

import (
	"bytes"
	"context"
	"math/rand"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"testing/quick"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestTransportRoundTrip_AllFields(t *testing.T) {
	request := requestFromSeed(42)

	if !roundTripHTTP(request) {
		t.Fatalf("http transport did not preserve request payload")
	}
	if !roundTripGRPC(request) {
		t.Fatalf("grpc transport did not preserve request payload")
	}
}

func TestTransportRoundTrip_Properties(t *testing.T) {
	cfg := &quick.Config{MaxCount: 20}
	err := quick.Check(func(seed uint64) bool {
		request := requestFromSeed(seed)
		return roundTripHTTP(request) && roundTripGRPC(request)
	}, cfg)
	if err != nil {
		t.Fatalf("transport roundtrip property failed: %v", err)
	}
}

func roundTripHTTP(request *sigilv1.ExportGenerationsRequest) bool {
	exporter := &capturingExporter{}
	handler := NewHTTPHandler(exporter)

	payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(request)
	if err != nil {
		return false
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/generations:export", bytes.NewReader(payload))
	resp := httptest.NewRecorder()
	handler(resp, req)
	if resp.Code != http.StatusAccepted {
		return false
	}

	var response sigilv1.ExportGenerationsResponse
	if err := protojson.Unmarshal(resp.Body.Bytes(), &response); err != nil {
		return false
	}
	if len(response.Results) != len(request.Generations) {
		return false
	}
	for i := range response.Results {
		if !response.Results[i].Accepted {
			return false
		}
		if response.Results[i].GenerationId != request.Generations[i].Id {
			return false
		}
	}

	captured := exporter.lastRequest()
	if captured == nil {
		return false
	}
	return proto.Equal(request, captured)
}

func roundTripGRPC(request *sigilv1.ExportGenerationsRequest) bool {
	exporter := &capturingExporter{}
	listener := bufconn.Listen(testBufSize)
	grpcServer := grpc.NewServer()
	sigilv1.RegisterGenerationIngestServiceServer(grpcServer, NewGRPCServer(exporter))

	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = grpcServer.Serve(listener)
	}()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		grpcServer.Stop()
		<-done
		return false
	}

	client := sigilv1.NewGenerationIngestServiceClient(conn)
	response, err := client.ExportGenerations(context.Background(), request)
	_ = conn.Close()
	grpcServer.Stop()
	<-done
	if err != nil {
		return false
	}
	if len(response.Results) != len(request.Generations) {
		return false
	}
	for i := range response.Results {
		if !response.Results[i].Accepted {
			return false
		}
		if response.Results[i].GenerationId != request.Generations[i].Id {
			return false
		}
	}

	captured := exporter.lastRequest()
	if captured == nil {
		return false
	}
	return proto.Equal(request, captured)
}

func requestFromSeed(seed uint64) *sigilv1.ExportGenerationsRequest {
	rnd := rand.New(rand.NewSource(int64(seed)))

	metadata, _ := structpb.NewStruct(map[string]any{
		"seed":    float64(seed % 100000),
		"enabled": seed%2 == 0,
		"nested": map[string]any{
			"name":  randomASCII(rnd, 8),
			"score": float64(rnd.Intn(1000)),
		},
	})

	generation := &sigilv1.Generation{
		Id:             "gen-" + randomASCII(rnd, 12),
		ConversationId: "conv-" + randomASCII(rnd, 10),
		AgentName:      "agent-" + randomASCII(rnd, 8),
		AgentVersion:   "v-" + randomASCII(rnd, 6),
		OperationName:  defaultOperationNameStream,
		Mode:           sigilv1.GenerationMode_GENERATION_MODE_STREAM,
		TraceId:        randomHex(rnd, 32),
		SpanId:         randomHex(rnd, 16),
		Model: &sigilv1.ModelRef{
			Provider: "provider-" + randomASCII(rnd, 6),
			Name:     "model-" + randomASCII(rnd, 6),
		},
		ResponseId:    "resp-" + randomASCII(rnd, 8),
		ResponseModel: "model-out-" + randomASCII(rnd, 5),
		SystemPrompt:  "system-" + randomASCII(rnd, 10),
		Input: []*sigilv1.Message{
			{
				Role: sigilv1.MessageRole_MESSAGE_ROLE_USER,
				Name: "input-user",
				Parts: []*sigilv1.Part{
					{Payload: &sigilv1.Part_Text{Text: "input-" + randomASCII(rnd, 10)}, Metadata: &sigilv1.PartMetadata{ProviderType: "text"}},
				},
			},
		},
		Output: []*sigilv1.Message{
			{
				Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
				Name: "assistant",
				Parts: []*sigilv1.Part{
					{Payload: &sigilv1.Part_Thinking{Thinking: "think-" + randomASCII(rnd, 8)}, Metadata: &sigilv1.PartMetadata{ProviderType: "thinking"}},
					{Payload: &sigilv1.Part_ToolCall{ToolCall: &sigilv1.ToolCall{Id: "call-" + randomASCII(rnd, 6), Name: "tool-" + randomASCII(rnd, 5), InputJson: []byte(`{"x":1}`)}}},
				},
			},
			{
				Role: sigilv1.MessageRole_MESSAGE_ROLE_TOOL,
				Name: "tool",
				Parts: []*sigilv1.Part{
					{Payload: &sigilv1.Part_ToolResult{ToolResult: &sigilv1.ToolResult{ToolCallId: "call-" + randomASCII(rnd, 6), Name: "tool-" + randomASCII(rnd, 5), Content: "ok", ContentJson: []byte(`{"ok":true}`), IsError: seed%3 == 0}}},
				},
			},
		},
		Tools: []*sigilv1.ToolDefinition{
			{Name: "tool-" + randomASCII(rnd, 6), Description: "desc-" + randomASCII(rnd, 8), Type: "function", InputSchemaJson: []byte(`{"type":"object"}`)},
		},
		Usage:       &sigilv1.TokenUsage{InputTokens: int64(rnd.Intn(1000)), OutputTokens: int64(rnd.Intn(1000)), TotalTokens: int64(rnd.Intn(2000) + 1), CacheReadInputTokens: int64(rnd.Intn(100)), CacheWriteInputTokens: int64(rnd.Intn(100)), ReasoningTokens: int64(rnd.Intn(100))},
		StopReason:  "stop-" + randomASCII(rnd, 4),
		StartedAt:   timestamppb.New(time.Unix(int64(seed%1000000), int64(seed%1000)*int64(time.Millisecond)).UTC()),
		CompletedAt: timestamppb.New(time.Unix(int64(seed%1000000)+1, int64(seed%1000)*int64(time.Millisecond)).UTC()),
		Tags: map[string]string{
			"tenant": "t-" + randomASCII(rnd, 4),
			"env":    "test",
		},
		Metadata: metadata,
		RawArtifacts: []*sigilv1.Artifact{
			{Kind: sigilv1.ArtifactKind_ARTIFACT_KIND_REQUEST, Name: "req", ContentType: "application/json", Payload: []byte(`{"request":true}`), RecordId: "rec-" + randomASCII(rnd, 6), Uri: "sigil://artifact/" + randomASCII(rnd, 6)},
			{Kind: sigilv1.ArtifactKind_ARTIFACT_KIND_PROVIDER_EVENT, Name: "evt", ContentType: "application/json", Payload: []byte(`{"event":true}`)},
		},
		CallError: "",
	}

	request := &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{generation}}
	clone := proto.Clone(request)
	typed, _ := clone.(*sigilv1.ExportGenerationsRequest)
	if typed == nil {
		return request
	}
	return typed
}

func randomASCII(rnd *rand.Rand, n int) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	bytes := make([]byte, n)
	for i := range bytes {
		bytes[i] = alphabet[rnd.Intn(len(alphabet))]
	}
	return string(bytes)
}

func randomHex(rnd *rand.Rand, n int) string {
	const alphabet = "0123456789abcdef"
	bytes := make([]byte, n)
	for i := range bytes {
		bytes[i] = alphabet[rnd.Intn(len(alphabet))]
	}
	return string(bytes)
}

type capturingExporter struct {
	mu      sync.Mutex
	request *sigilv1.ExportGenerationsRequest
}

func (e *capturingExporter) Export(_ context.Context, req *sigilv1.ExportGenerationsRequest) *sigilv1.ExportGenerationsResponse {
	clone := proto.Clone(req)
	typed, ok := clone.(*sigilv1.ExportGenerationsRequest)
	if ok {
		e.mu.Lock()
		e.request = typed
		e.mu.Unlock()
	}

	results := make([]*sigilv1.ExportGenerationResult, len(req.GetGenerations()))
	for i := range req.GetGenerations() {
		results[i] = &sigilv1.ExportGenerationResult{GenerationId: req.Generations[i].Id, Accepted: true}
	}

	return &sigilv1.ExportGenerationsResponse{Results: results}
}

func (e *capturingExporter) lastRequest() *sigilv1.ExportGenerationsRequest {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.request == nil {
		return nil
	}
	clone := proto.Clone(e.request)
	typed, _ := clone.(*sigilv1.ExportGenerationsRequest)
	return typed
}

var _ Exporter = (*capturingExporter)(nil)
