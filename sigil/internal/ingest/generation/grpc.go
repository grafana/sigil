package generation

import (
	"context"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

type GRPCServer struct {
	sigilv1.UnimplementedGenerationIngestServiceServer

	exporter Exporter
}

func NewGRPCServer(exporter Exporter) *GRPCServer {
	return &GRPCServer{exporter: exporter}
}

func (s *GRPCServer) ExportGenerations(ctx context.Context, req *sigilv1.ExportGenerationsRequest) (*sigilv1.ExportGenerationsResponse, error) {
	return s.exporter.Export(ctx, req), nil
}
