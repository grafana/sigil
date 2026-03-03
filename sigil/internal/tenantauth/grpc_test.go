package tenantauth

import (
	"context"
	"testing"

	"github.com/grafana/dskit/tenant"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestUnaryServerInterceptorRequiresTenantMetadataWhenEnabled(t *testing.T) {
	interceptor := UnaryServerInterceptor(Config{Enabled: true, FakeTenantID: "fake"})
	before := testutil.ToFloat64(authFailuresTotal.WithLabelValues("grpc", "tenant_context"))
	_, err := interceptor(context.Background(), nil, &grpc.UnaryServerInfo{}, func(ctx context.Context, req any) (any, error) {
		return nil, nil
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated, got %v", err)
	}
	after := testutil.ToFloat64(authFailuresTotal.WithLabelValues("grpc", "tenant_context"))
	if delta := after - before; delta != 1 {
		t.Fatalf("expected auth failure metric increment of 1, got %v", delta)
	}
}

func TestUnaryServerInterceptorInjectsTenant(t *testing.T) {
	interceptor := UnaryServerInterceptor(Config{Enabled: true, FakeTenantID: "fake"})
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-scope-orgid", "tenant-a"))
	_, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{}, func(ctx context.Context, req any) (any, error) {
		tenantID, err := tenant.TenantID(ctx)
		if err != nil {
			t.Fatalf("extract tenant id: %v", err)
		}
		if tenantID != "tenant-a" {
			t.Fatalf("expected tenant-a, got %q", tenantID)
		}
		return nil, nil
	})
	if err != nil {
		t.Fatalf("interceptor returned error: %v", err)
	}
}

func TestInjectTenantContextUsesFakeTenantWhenDisabled(t *testing.T) {
	ctx, err := injectTenantContext(context.Background(), Config{Enabled: false, FakeTenantID: "local-fake"})
	if err != nil {
		t.Fatalf("inject tenant context: %v", err)
	}
	tenantID, err := tenant.TenantID(ctx)
	if err != nil {
		t.Fatalf("extract tenant id: %v", err)
	}
	if tenantID != "local-fake" {
		t.Fatalf("expected local-fake, got %q", tenantID)
	}
}
