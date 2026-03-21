package sigil

import "testing"

func TestMetricRouteLabel(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name  string
		route string
		want  string
	}{
		{
			name:  "empty route uses unmatched",
			route: "  ",
			want:  "unmatched",
		},
		{
			name:  "non-empty route is trimmed",
			route: " /api/v1/conversations ",
			want:  "/api/v1/conversations",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := metricRouteLabel(tc.route); got != tc.want {
				t.Fatalf("metricRouteLabel(%q) = %q, want %q", tc.route, got, tc.want)
			}
		})
	}
}

func TestMetricStatusClass(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name   string
		status int
		want   string
	}{
		{name: "1xx", status: 101, want: "1xx"},
		{name: "2xx", status: 204, want: "2xx"},
		{name: "3xx", status: 302, want: "3xx"},
		{name: "4xx", status: 404, want: "4xx"},
		{name: "5xx", status: 503, want: "5xx"},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := metricStatusClass(tc.status); got != tc.want {
				t.Fatalf("metricStatusClass(%d) = %q, want %q", tc.status, got, tc.want)
			}
		})
	}
}

func TestMetricRequestArea(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name        string
		route       string
		requestPath string
		want        string
	}{
		{
			name:        "feedback via conversations catch-all ratings",
			route:       "/api/v1/conversations/",
			requestPath: "/api/v1/conversations/conv-1/ratings",
			want:        "feedback",
		},
		{
			name:        "feedback via conversations catch-all annotations",
			route:       "/api/v1/conversations/",
			requestPath: "/api/v1/conversations/conv-1/annotations",
			want:        "feedback",
		},
		{
			name:        "conversation detail stays query",
			route:       "/api/v1/conversations/",
			requestPath: "/api/v1/conversations/conv-1",
			want:        "query",
		},
		{
			name:        "list conversations stays query",
			route:       "/api/v1/conversations",
			requestPath: "/api/v1/conversations",
			want:        "query",
		},
		{
			name:        "direct feedback route remains feedback",
			route:       "/api/v1/conversations/{id}/ratings",
			requestPath: "/api/v1/conversations/conv-1/ratings",
			want:        "feedback",
		},
		{
			name:        "direct annotations route remains feedback",
			route:       "/api/v1/conversations/{id}/annotations",
			requestPath: "/api/v1/conversations/conv-1/annotations",
			want:        "feedback",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := metricRequestArea(tc.route, tc.requestPath); got != tc.want {
				t.Fatalf("metricRequestArea(%q, %q) = %q, want %q", tc.route, tc.requestPath, got, tc.want)
			}
		})
	}
}

func TestIsFeedbackPath(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name string
		path string
		want bool
	}{
		{
			name: "ratings route",
			path: "/api/v1/conversations/conv-1/ratings",
			want: true,
		},
		{
			name: "annotations route",
			path: "/api/v1/conversations/conv-1/annotations",
			want: true,
		},
		{
			name: "trimmed input is supported",
			path: " /api/v1/conversations/conv-1/ratings ",
			want: true,
		},
		{
			name: "non-conversation route is rejected",
			path: "/api/v1/generations/123/ratings",
			want: false,
		},
		{
			name: "conversation route without feedback suffix is rejected",
			path: "/api/v1/conversations/conv-1",
			want: false,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := isFeedbackPath(tc.path); got != tc.want {
				t.Fatalf("isFeedbackPath(%q) = %t, want %t", tc.path, got, tc.want)
			}
		})
	}
}
