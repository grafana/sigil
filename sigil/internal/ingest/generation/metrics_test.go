package generation

import (
	"context"
	"testing"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

func TestTransportFromContext(t *testing.T) {
	testCases := []struct {
		name string
		ctx  context.Context
		want string
	}{
		{
			name: "nil context",
			ctx:  nil,
			want: generationUnknownLabel,
		},
		{
			name: "missing transport",
			ctx:  context.Background(),
			want: generationUnknownLabel,
		},
		{
			name: "normalized transport",
			ctx:  withTransport(context.Background(), " gRPC "),
			want: "grpc",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := transportFromContext(tc.ctx); got != tc.want {
				t.Fatalf("transportFromContext() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestGenerationModeLabel(t *testing.T) {
	testCases := []struct {
		name string
		mode sigilv1.GenerationMode
		want string
	}{
		{
			name: "sync mode",
			mode: sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			want: "sync",
		},
		{
			name: "stream mode",
			mode: sigilv1.GenerationMode_GENERATION_MODE_STREAM,
			want: "stream",
		},
		{
			name: "unknown mode",
			mode: sigilv1.GenerationMode_GENERATION_MODE_UNSPECIFIED,
			want: generationUnknownLabel,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := generationModeLabel(tc.mode); got != tc.want {
				t.Fatalf("generationModeLabel() = %q, want %q", got, tc.want)
			}
		})
	}
}
