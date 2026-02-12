package trace

import (
	"context"

	collecttracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type GRPCServer struct {
	collecttracev1.UnimplementedTraceServiceServer

	service *Service
}

func NewGRPCServer(service *Service) *GRPCServer {
	return &GRPCServer{service: service}
}

func (s *GRPCServer) Export(ctx context.Context, request *collecttracev1.ExportTraceServiceRequest) (*collecttracev1.ExportTraceServiceResponse, error) {
	response, err := s.service.ForwardToTempoGRPC(ctx, request)
	if err != nil {
		if _, ok := status.FromError(err); ok {
			return nil, err
		}
		return nil, status.Error(codes.Unavailable, err.Error())
	}
	if response == nil {
		return &collecttracev1.ExportTraceServiceResponse{}, nil
	}
	return response, nil
}
