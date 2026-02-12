package tenantauth

import (
	"context"

	"github.com/grafana/dskit/tenant"
	"github.com/grafana/dskit/user"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func UnaryServerInterceptor(cfg Config) grpc.UnaryServerInterceptor {
	cfg = normalizeConfig(cfg)
	return func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		var err error
		ctx, err = injectTenantContext(ctx, cfg)
		if err != nil {
			return nil, status.Error(codes.Unauthenticated, err.Error())
		}
		return handler(ctx, req)
	}
}

func StreamServerInterceptor(cfg Config) grpc.StreamServerInterceptor {
	cfg = normalizeConfig(cfg)
	return func(srv any, ss grpc.ServerStream, _ *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		ctx, err := injectTenantContext(ss.Context(), cfg)
		if err != nil {
			return status.Error(codes.Unauthenticated, err.Error())
		}
		return handler(srv, wrappedServerStream{ServerStream: ss, ctx: ctx})
	}
}

func injectTenantContext(ctx context.Context, cfg Config) (context.Context, error) {
	if cfg.Enabled {
		_, extractedCtx, err := user.ExtractFromGRPCRequest(ctx)
		if err != nil {
			return nil, err
		}
		if _, err := tenant.TenantID(extractedCtx); err != nil {
			return nil, err
		}
		return extractedCtx, nil
	}

	if err := tenant.ValidTenantID(cfg.FakeTenantID); err != nil {
		return nil, err
	}
	return user.InjectOrgID(ctx, cfg.FakeTenantID), nil
}

type wrappedServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (w wrappedServerStream) Context() context.Context {
	return w.ctx
}
