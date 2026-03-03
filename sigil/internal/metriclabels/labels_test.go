package metriclabels

import "testing"

func TestTransport(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "http", input: "http", want: "http"},
		{name: "grpc uppercase", input: " GRPC ", want: "grpc"},
		{name: "unknown", input: "tcp", want: "unknown"},
		{name: "empty", input: " ", want: "unknown"},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := Transport(tc.input); got != tc.want {
				t.Fatalf("Transport(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestReason(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "keeps value", input: "validation_error", want: "validation_error"},
		{name: "trimmed", input: " unauthorized ", want: "unauthorized"},
		{name: "empty", input: "", want: "unknown"},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := Reason(tc.input); got != tc.want {
				t.Fatalf("Reason(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestTenantID(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "keeps value", input: "tenant-a", want: "tenant-a"},
		{name: "trimmed", input: " tenant-b ", want: "tenant-b"},
		{name: "empty", input: "\t", want: "unknown"},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := TenantID(tc.input); got != tc.want {
				t.Fatalf("TenantID(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}
