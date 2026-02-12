package trace

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"

	"github.com/grafana/sigil/sigil/internal/tempo"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	collecttracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	resourcev1 "go.opentelemetry.io/proto/otlp/resource/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
)

const ingestBufSize = 1024 * 1024

func TestOTLPGRPCExportRequiresTenantMetadata(t *testing.T) {
	forwarder := &testTempoForwarder{}
	client, cleanup := newIngestTraceClient(t, NewService(forwarder), tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	defer cleanup()

	_, err := client.Export(context.Background(), testTraceRequest())
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated for missing tenant metadata, got %v", err)
	}
}

func TestOTLPGRPCExportReturnsUpstreamResponse(t *testing.T) {
	forwarder := &testTempoForwarder{
		grpcResponse: &collecttracev1.ExportTraceServiceResponse{
			PartialSuccess: &collecttracev1.ExportTracePartialSuccess{
				RejectedSpans: 2,
				ErrorMessage:  "partial",
			},
		},
	}
	client, cleanup := newIngestTraceClient(t, NewService(forwarder), tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	defer cleanup()

	ctx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs("x-scope-orgid", "tenant-a"))
	response, err := client.Export(ctx, testTraceRequest())
	if err != nil {
		t.Fatalf("export traces: %v", err)
	}
	if response.GetPartialSuccess().GetRejectedSpans() != 2 {
		t.Fatalf("expected rejected spans 2, got %d", response.GetPartialSuccess().GetRejectedSpans())
	}
}

func TestOTLPGRPCExportPropagatesUpstreamStatusError(t *testing.T) {
	forwarder := &testTempoForwarder{
		grpcErr: status.Error(codes.ResourceExhausted, "tempo throttled"),
	}
	client, cleanup := newIngestTraceClient(t, NewService(forwarder), tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	defer cleanup()

	ctx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs("x-scope-orgid", "tenant-a"))
	_, err := client.Export(ctx, testTraceRequest())
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("expected resource exhausted, got %v", err)
	}
}

func TestOTLPGRPCExportWrapsNonStatusErrorAsUnavailable(t *testing.T) {
	forwarder := &testTempoForwarder{
		grpcErr: errors.New("dial failed"),
	}
	client, cleanup := newIngestTraceClient(t, NewService(forwarder), tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	defer cleanup()

	ctx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs("x-scope-orgid", "tenant-a"))
	_, err := client.Export(ctx, testTraceRequest())
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("expected unavailable, got %v", err)
	}
}

func TestOTLPGRPCExportForwardsMetadataToTempo(t *testing.T) {
	upstream := newCapturingTempoGRPCServer(t)
	tempoClient := tempo.NewClient(upstream.listener.Addr().String(), "tempo:4318")
	defer func() {
		_ = tempoClient.Close()
	}()

	client, cleanup := newIngestTraceClient(t, NewService(tempoClient), tenantauth.Config{Enabled: true, FakeTenantID: "fake"})
	defer cleanup()

	ctx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs(
		"x-scope-orgid", "tenant-a",
		"authorization", "Bearer trace-secret",
		"x-custom-header", "custom",
	))
	response, err := client.Export(ctx, testTraceRequest())
	if err != nil {
		t.Fatalf("export traces: %v", err)
	}
	if response == nil {
		t.Fatalf("expected non-nil response")
	}

	upstreamMD := upstream.lastMetadata()
	if got := firstValue(upstreamMD, "x-scope-orgid"); got != "tenant-a" {
		t.Fatalf("expected upstream tenant metadata tenant-a, got %q", got)
	}
	if got := firstValue(upstreamMD, "authorization"); got != "Bearer trace-secret" {
		t.Fatalf("expected upstream authorization metadata, got %q", got)
	}
	if got := firstValue(upstreamMD, "x-custom-header"); got != "custom" {
		t.Fatalf("expected upstream custom metadata custom, got %q", got)
	}

	if !proto.Equal(testTraceRequest(), upstream.lastRequest()) {
		t.Fatalf("expected forwarded request payload to match")
	}
}

func newIngestTraceClient(t *testing.T, service *Service, authCfg tenantauth.Config) (collecttracev1.TraceServiceClient, func()) {
	t.Helper()

	listener := bufconn.Listen(ingestBufSize)
	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(tenantauth.UnaryServerInterceptor(authCfg)),
		grpc.StreamInterceptor(tenantauth.StreamServerInterceptor(authCfg)),
	)
	collecttracev1.RegisterTraceServiceServer(grpcServer, NewGRPCServer(service))

	go func() {
		_ = grpcServer.Serve(listener)
	}()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial grpc server: %v", err)
	}

	cleanup := func() {
		_ = conn.Close()
		grpcServer.Stop()
	}
	return collecttracev1.NewTraceServiceClient(conn), cleanup
}

func testTraceRequest() *collecttracev1.ExportTraceServiceRequest {
	return &collecttracev1.ExportTraceServiceRequest{
		ResourceSpans: []*tracev1.ResourceSpans{
			{
				Resource: &resourcev1.Resource{
					Attributes: []*commonv1.KeyValue{
						{
							Key: "service.name",
							Value: &commonv1.AnyValue{
								Value: &commonv1.AnyValue_StringValue{StringValue: "sigil-test"},
							},
						},
					},
				},
				ScopeSpans: []*tracev1.ScopeSpans{{}},
			},
		},
	}
}

type capturingTempoGRPCServer struct {
	collecttracev1.UnimplementedTraceServiceServer

	listener net.Listener
	server   *grpc.Server

	mu       sync.Mutex
	request  *collecttracev1.ExportTraceServiceRequest
	metadata metadata.MD
}

func newCapturingTempoGRPCServer(t *testing.T) *capturingTempoGRPCServer {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen upstream grpc: %v", err)
	}

	capture := &capturingTempoGRPCServer{
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

func (s *capturingTempoGRPCServer) Export(ctx context.Context, request *collecttracev1.ExportTraceServiceRequest) (*collecttracev1.ExportTraceServiceResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	md, _ := metadata.FromIncomingContext(ctx)
	s.metadata = md.Copy()
	cloned := proto.Clone(request)
	typed, ok := cloned.(*collecttracev1.ExportTraceServiceRequest)
	if ok {
		s.request = typed
	}

	return &collecttracev1.ExportTraceServiceResponse{}, nil
}

func (s *capturingTempoGRPCServer) lastRequest() *collecttracev1.ExportTraceServiceRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.request == nil {
		return nil
	}
	cloned := proto.Clone(s.request)
	request, _ := cloned.(*collecttracev1.ExportTraceServiceRequest)
	return request
}

func (s *capturingTempoGRPCServer) lastMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.metadata == nil {
		return nil
	}
	return s.metadata.Copy()
}

func firstValue(md metadata.MD, key string) string {
	if md == nil {
		return ""
	}
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
