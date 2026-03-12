package ingest

import (
	"context"
	"testing"
)

func TestTransportFromContext(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		ctx  context.Context
		want string
	}{
		{
			name: "nil context",
			ctx:  nil,
			want: scoreIngestUnknownLabel,
		},
		{
			name: "missing transport value",
			ctx:  context.Background(),
			want: scoreIngestUnknownLabel,
		},
		{
			name: "transport is normalized",
			ctx:  withTransport(context.Background(), " http "),
			want: "http",
		},
		{
			name: "empty transport falls back to unknown",
			ctx:  withTransport(context.Background(), " "),
			want: scoreIngestUnknownLabel,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := transportFromContext(tc.ctx)
			if got != tc.want {
				t.Fatalf("transportFromContext() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestWithTransportAllowsNilContext(t *testing.T) {
	t.Parallel()

	//nolint:staticcheck // Intentional nil context to verify withTransport fallback behavior.
	ctx := withTransport(nil, "grpc")
	if got := transportFromContext(ctx); got != "grpc" {
		t.Fatalf("transportFromContext(withTransport(nil, ...)) = %q, want %q", got, "grpc")
	}
}
