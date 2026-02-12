package generation

import (
	"context"
	"net"
	"testing"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/tenantauth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

const testBufSize = 1024 * 1024

func TestGRPCExportGenerations(t *testing.T) {
	listener := bufconn.Listen(testBufSize)
	authCfg := tenantauth.Config{Enabled: true, FakeTenantID: "fake"}
	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(tenantauth.UnaryServerInterceptor(authCfg)),
		grpc.StreamInterceptor(tenantauth.StreamServerInterceptor(authCfg)),
	)
	sigilv1.RegisterGenerationIngestServiceServer(grpcServer, NewGRPCServer(NewService(NewMemoryStore())))

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

	client := sigilv1.NewGenerationIngestServiceClient(conn)
	_, err = client.ExportGenerations(context.Background(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-grpc",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_STREAM,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated for missing tenant metadata, got %v", err)
	}

	ctx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs("x-scope-orgid", "tenant-a"))
	response, err := client.ExportGenerations(ctx, &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-grpc",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_STREAM,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}})
	if err != nil {
		t.Fatalf("export generations: %v", err)
	}

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected accepted result, got %q", response.Results[0].Error)
	}
	if response.Results[0].GenerationId != "gen-grpc" {
		t.Fatalf("expected generation id gen-grpc, got %q", response.Results[0].GenerationId)
	}
}
