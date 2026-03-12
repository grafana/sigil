package sigil

import (
	"context"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"google.golang.org/grpc"
	"google.golang.org/grpc/status"
)

var (
	grpcServerRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_grpc_server_requests_total",
		Help: "Total number of gRPC server requests by service, method, type, and code.",
	}, []string{"service", "method", "type", "code"})
	grpcServerRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_grpc_server_request_duration_seconds",
		Help:    "gRPC server request duration in seconds by service, method, and type.",
		Buckets: prometheus.DefBuckets,
	}, []string{"service", "method", "type"})
)

const grpcUnknownLabel = "unknown"

func grpcMetricsUnaryInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		service, method := parseGRPCMethod(info)
		start := time.Now()
		resp, err := handler(ctx, req)
		code := status.Code(err).String()
		grpcServerRequestsTotal.WithLabelValues(service, method, "unary", code).Inc()
		grpcServerRequestDuration.WithLabelValues(service, method, "unary").Observe(time.Since(start).Seconds())
		return resp, err
	}
}

func grpcMetricsStreamInterceptor() grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		service, method := parseGRPCFullMethod(info.FullMethod)
		start := time.Now()
		err := handler(srv, ss)
		code := status.Code(err).String()
		grpcServerRequestsTotal.WithLabelValues(service, method, "stream", code).Inc()
		grpcServerRequestDuration.WithLabelValues(service, method, "stream").Observe(time.Since(start).Seconds())
		return err
	}
}

func parseGRPCMethod(info *grpc.UnaryServerInfo) (service, method string) {
	if info == nil {
		return unknownGRPCMethodLabels()
	}
	return parseGRPCFullMethod(info.FullMethod)
}

func parseGRPCFullMethod(fullMethod string) (service, method string) {
	trimmed := strings.TrimSpace(fullMethod)
	if trimmed == "" {
		return unknownGRPCMethodLabels()
	}
	trimmed = strings.TrimPrefix(trimmed, "/")
	service, method, ok := strings.Cut(trimmed, "/")
	if !ok {
		return unknownGRPCMethodLabels()
	}
	service = strings.TrimSpace(service)
	method = strings.TrimSpace(method)
	if service == "" || method == "" {
		return unknownGRPCMethodLabels()
	}
	return service, method
}

func unknownGRPCMethodLabels() (service, method string) {
	return grpcUnknownLabel, grpcUnknownLabel
}
