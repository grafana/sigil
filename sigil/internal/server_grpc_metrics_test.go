package sigil

import (
	"testing"

	"google.golang.org/grpc"
)

func TestParseGRPCMethod(t *testing.T) {
	t.Run("nil info falls back to unknown labels", func(t *testing.T) {
		service, method := parseGRPCMethod(nil)
		if service != grpcUnknownLabel || method != grpcUnknownLabel {
			t.Fatalf("expected unknown labels, got service=%q method=%q", service, method)
		}
	})

	t.Run("parses service and method from full method", func(t *testing.T) {
		service, method := parseGRPCMethod(&grpc.UnaryServerInfo{
			FullMethod: "/sigil.v1.GenerationIngestService/ExportGenerations",
		})
		if service != "sigil.v1.GenerationIngestService" || method != "ExportGenerations" {
			t.Fatalf("unexpected parse result service=%q method=%q", service, method)
		}
	})
}

func TestParseGRPCFullMethod(t *testing.T) {
	testCases := []struct {
		name       string
		fullMethod string
		service    string
		method     string
	}{
		{
			name:       "empty value",
			fullMethod: "",
			service:    grpcUnknownLabel,
			method:     grpcUnknownLabel,
		},
		{
			name:       "whitespace value",
			fullMethod: " \t ",
			service:    grpcUnknownLabel,
			method:     grpcUnknownLabel,
		},
		{
			name:       "missing method separator",
			fullMethod: "/sigil.v1.GenerationIngestService",
			service:    grpcUnknownLabel,
			method:     grpcUnknownLabel,
		},
		{
			name:       "missing method token",
			fullMethod: "/sigil.v1.GenerationIngestService/ ",
			service:    grpcUnknownLabel,
			method:     grpcUnknownLabel,
		},
		{
			name:       "trimmed full method",
			fullMethod: " /sigil.v1.GenerationIngestService/ExportGenerations ",
			service:    "sigil.v1.GenerationIngestService",
			method:     "ExportGenerations",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			service, method := parseGRPCFullMethod(testCase.fullMethod)
			if service != testCase.service || method != testCase.method {
				t.Fatalf(
					"unexpected parse result for %q: service=%q method=%q",
					testCase.fullMethod,
					service,
					method,
				)
			}
		})
	}
}
