package ingest

import (
	"context"
	"net"
	"testing"

	"github.com/grafana/sigil/api/internal/tempo"
	"github.com/grafana/sigil/api/internal/tenantauth"
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
)

const ingestBufSize = 1024 * 1024

func TestOTLPGRPCExport(t *testing.T) {
	listener := bufconn.Listen(ingestBufSize)
	authCfg := tenantauth.Config{Enabled: true, FakeTenantID: "fake"}
	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(tenantauth.UnaryServerInterceptor(authCfg)),
		grpc.StreamInterceptor(tenantauth.StreamServerInterceptor(authCfg)),
	)
	collecttracev1.RegisterTraceServiceServer(grpcServer, NewGRPCServer(NewService(tempo.NewClient("tempo:4317"))))

	go func() {
		_ = grpcServer.Serve(listener)
	}()
	t.Cleanup(func() {
		grpcServer.Stop()
	})

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial grpc server: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	client := collecttracev1.NewTraceServiceClient(conn)
	_, err = client.Export(context.Background(), &collecttracev1.ExportTraceServiceRequest{
		ResourceSpans: []*tracev1.ResourceSpans{
			{
				Resource: &resourcev1.Resource{
					Attributes: []*commonv1.KeyValue{
						{Key: "service.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "sigil-test"}}},
					},
				},
				ScopeSpans: []*tracev1.ScopeSpans{{}},
			},
		},
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated for missing tenant metadata, got %v", err)
	}

	ctx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs("x-scope-orgid", "tenant-a"))
	_, err = client.Export(ctx, &collecttracev1.ExportTraceServiceRequest{
		ResourceSpans: []*tracev1.ResourceSpans{
			{
				Resource: &resourcev1.Resource{
					Attributes: []*commonv1.KeyValue{
						{Key: "service.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "sigil-test"}}},
					},
				},
				ScopeSpans: []*tracev1.ScopeSpans{{}},
			},
		},
	})
	if err != nil {
		t.Fatalf("export traces: %v", err)
	}
}
