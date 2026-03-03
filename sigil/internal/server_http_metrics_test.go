package sigil

import "testing"

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
