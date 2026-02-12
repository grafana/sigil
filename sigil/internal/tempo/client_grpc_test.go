package tempo

import (
	"context"
	"net"
	"sync"
	"testing"

	collecttracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	resourcev1 "go.opentelemetry.io/proto/otlp/resource/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestForwardTraceGRPCForwardsRequestAndMetadata(t *testing.T) {
	upstream := newCapturingTraceServer(t)
	client := NewClient(upstream.listener.Addr().String(), "tempo:4318")
	defer func() {
		_ = client.Close()
	}()

	request := testExportTraceRequest()
	ctx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs(
		"x-scope-orgid", "tenant-outgoing",
		"x-outgoing-only", "preserved",
	))
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-scope-orgid", "tenant-incoming",
		"authorization", "Bearer trace-secret",
	))

	response, err := client.ForwardTraceGRPC(ctx, request)
	if err != nil {
		t.Fatalf("forward trace over grpc: %v", err)
	}
	if response.GetPartialSuccess().GetRejectedSpans() != 1 {
		t.Fatalf("expected rejected spans 1, got %d", response.GetPartialSuccess().GetRejectedSpans())
	}

	if !proto.Equal(request, upstream.lastRequest()) {
		t.Fatalf("expected upstream request payload to match")
	}

	md := upstream.lastMetadata()
	if got := firstMDValue(md, "x-scope-orgid"); got != "tenant-incoming" {
		t.Fatalf("expected incoming tenant metadata to win, got %q", got)
	}
	if got := firstMDValue(md, "authorization"); got != "Bearer trace-secret" {
		t.Fatalf("expected authorization metadata, got %q", got)
	}
	if got := firstMDValue(md, "x-outgoing-only"); got != "preserved" {
		t.Fatalf("expected outgoing-only metadata to be preserved, got %q", got)
	}
}

func TestForwardTraceGRPCPropagatesUpstreamStatusError(t *testing.T) {
	upstream := newCapturingTraceServer(t)
	upstream.setErr(status.Error(codes.ResourceExhausted, "tempo throttled"))

	client := NewClient(upstream.listener.Addr().String(), "tempo:4318")
	defer func() {
		_ = client.Close()
	}()

	_, err := client.ForwardTraceGRPC(context.Background(), testExportTraceRequest())
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("expected resource exhausted, got %v", err)
	}
}

func TestCloseReleasesConnection(t *testing.T) {
	upstream := newCapturingTraceServer(t)

	client := NewClient(upstream.listener.Addr().String(), "tempo:4318")
	_, err := client.ForwardTraceGRPC(context.Background(), testExportTraceRequest())
	if err != nil {
		t.Fatalf("forward trace over grpc: %v", err)
	}
	if client.grpcConn == nil {
		t.Fatalf("expected grpc connection to be initialized")
	}

	if err := client.Close(); err != nil {
		t.Fatalf("close client: %v", err)
	}
	if client.grpcConn != nil {
		t.Fatalf("expected grpc connection to be released")
	}
	if client.grpcClient != nil {
		t.Fatalf("expected grpc client to be released")
	}
}

type capturingTraceServer struct {
	collecttracev1.UnimplementedTraceServiceServer

	listener net.Listener
	server   *grpc.Server

	mu       sync.Mutex
	request  *collecttracev1.ExportTraceServiceRequest
	metadata metadata.MD
	err      error
}

func newCapturingTraceServer(t *testing.T) *capturingTraceServer {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen upstream grpc: %v", err)
	}

	capture := &capturingTraceServer{
		listener: listener,
		server:   grpc.NewServer(),
	}
	collecttracev1.RegisterTraceServiceServer(capture.server, capture)

	go func() {
		_ = capture.server.Serve(listener)
	}()

	t.Cleanup(func() {
		capture.server.Stop()
		_ = listener.Close()
	})

	return capture
}

func (s *capturingTraceServer) Export(ctx context.Context, request *collecttracev1.ExportTraceServiceRequest) (*collecttracev1.ExportTraceServiceResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	md, _ := metadata.FromIncomingContext(ctx)
	s.metadata = md.Copy()

	cloned := proto.Clone(request)
	typed, ok := cloned.(*collecttracev1.ExportTraceServiceRequest)
	if ok {
		s.request = typed
	}

	if s.err != nil {
		return nil, s.err
	}

	return &collecttracev1.ExportTraceServiceResponse{
		PartialSuccess: &collecttracev1.ExportTracePartialSuccess{
			RejectedSpans: 1,
			ErrorMessage:  "partial",
		},
	}, nil
}

func (s *capturingTraceServer) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err = err
}

func (s *capturingTraceServer) lastRequest() *collecttracev1.ExportTraceServiceRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.request == nil {
		return nil
	}
	cloned := proto.Clone(s.request)
	request, _ := cloned.(*collecttracev1.ExportTraceServiceRequest)
	return request
}

func (s *capturingTraceServer) lastMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.metadata == nil {
		return nil
	}
	return s.metadata.Copy()
}

func firstMDValue(md metadata.MD, key string) string {
	if md == nil {
		return ""
	}
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func testExportTraceRequest() *collecttracev1.ExportTraceServiceRequest {
	return &collecttracev1.ExportTraceServiceRequest{
		ResourceSpans: []*tracev1.ResourceSpans{
			{
				Resource: &resourcev1.Resource{
					Attributes: []*commonv1.KeyValue{
						{
							Key: "service.name",
							Value: &commonv1.AnyValue{
								Value: &commonv1.AnyValue_StringValue{
									StringValue: "sigil-test",
								},
							},
						},
					},
				},
				ScopeSpans: []*tracev1.ScopeSpans{{}},
			},
		},
	}
}
