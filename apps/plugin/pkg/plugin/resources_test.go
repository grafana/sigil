package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

type mockCallResourceResponseSender struct {
	response *backend.CallResourceResponse
}

func (s *mockCallResourceResponseSender) Send(response *backend.CallResourceResponse) error {
	s.response = response
	return nil
}

func TestCallResource(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/conversations":
			_, _ = io.WriteString(w, `{"items":[]}`)
		case "/api/v1/conversations/c-1":
			_, _ = io.WriteString(w, `{"id":"c-1"}`)
		case "/api/v1/completions":
			_, _ = io.WriteString(w, `{"items":[]}`)
		case "/api/v1/traces/t-1":
			_, _ = io.WriteString(w, `{"id":"t-1"}`)
		case "/api/v1/conversations/c-1/ratings":
			if r.Method == http.MethodPost {
				body, _ := io.ReadAll(r.Body)
				_, _ = io.WriteString(w, string(body))
				return
			}
			_, _ = io.WriteString(w, `{"items":[{"rating_id":"rat-1"}]}`)
		case "/api/v1/conversations/c-1/annotations":
			if r.Method == http.MethodPost {
				if got := r.Header.Get("X-Sigil-Operator-Id"); got != "operator-1" {
					http.Error(w, "missing operator id", http.StatusUnauthorized)
					return
				}
				body, _ := io.ReadAll(r.Body)
				_, _ = io.WriteString(w, string(body))
				return
			}
			_, _ = io.WriteString(w, `{"items":[{"annotation_id":"ann-1"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.apiURL = upstream.URL

	for _, tc := range []struct {
		name      string
		method    string
		path      string
		expStatus int
		expBody   []byte
	}{
		{
			name:      "get conversations",
			method:    http.MethodGet,
			path:      "query/conversations",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"items":[]}`),
		},
		{
			name:      "get conversation by id",
			method:    http.MethodGet,
			path:      "query/conversations/c-1",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"id":"c-1"}`),
		},
		{
			name:      "get completions",
			method:    http.MethodGet,
			path:      "query/completions",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"items":[]}`),
		},
		{
			name:      "get trace by id",
			method:    http.MethodGet,
			path:      "query/traces/t-1",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"id":"t-1"}`),
		},
		{
			name:      "post not allowed",
			method:    http.MethodPost,
			path:      "query/completions",
			expStatus: http.StatusMethodNotAllowed,
		},
		{
			name:      "list ratings",
			method:    http.MethodGet,
			path:      "query/conversations/c-1/ratings",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"items":[{"rating_id":"rat-1"}]}`),
		},
		{
			name:      "list annotations",
			method:    http.MethodGet,
			path:      "query/conversations/c-1/annotations",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"items":[{"annotation_id":"ann-1"}]}`),
		},
		{
			name:      "missing route",
			method:    http.MethodGet,
			path:      "not-found",
			expStatus: http.StatusNotFound,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var r mockCallResourceResponseSender
			err = app.CallResource(context.Background(), &backend.CallResourceRequest{
				Method: tc.method,
				Path:   tc.path,
			}, &r)
			if err != nil {
				t.Fatalf("CallResource error: %s", err)
			}
			if r.response == nil {
				t.Fatal("no response received from CallResource")
			}
			if tc.expStatus != r.response.Status {
				t.Fatalf("response status should be %d, got %d", tc.expStatus, r.response.Status)
			}
			if len(tc.expBody) > 0 {
				if tb := bytes.TrimSpace(r.response.Body); !bytes.Equal(tb, tc.expBody) {
					t.Fatalf("response body should be %s, got %s", tc.expBody, tb)
				}
			}
		})
	}
}

func TestCallResourceSupportsConversationRatingAndAnnotationWrites(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/conversations/c-1/ratings":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			body, _ := io.ReadAll(r.Body)
			_, _ = io.WriteString(w, string(body))
		case "/api/v1/conversations/c-1/annotations":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if r.Header.Get("X-Sigil-Operator-Id") != "operator-1" {
				http.Error(w, "missing operator", http.StatusUnauthorized)
				return
			}
			body, _ := io.ReadAll(r.Body)
			_, _ = io.WriteString(w, string(body))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.apiURL = upstream.URL

	testCases := []struct {
		name      string
		path      string
		headers   map[string][]string
		body      []byte
		pluginCtx backend.PluginContext
		expStatus int
	}{
		{
			name:      "create rating",
			path:      "query/conversations/c-1/ratings",
			body:      []byte(`{"rating_id":"rat-1","rating":"CONVERSATION_RATING_VALUE_GOOD"}`),
			expStatus: http.StatusOK,
		},
		{
			name: "create annotation with injected operator",
			path: "query/conversations/c-1/annotations",
			pluginCtx: backend.PluginContext{
				User: &backend.User{
					Login: "operator-1",
					Name:  "Alice",
					Email: "alice@example.com",
				},
			},
			body:      []byte(`{"annotation_id":"ann-1","annotation_type":"NOTE"}`),
			expStatus: http.StatusOK,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var sender mockCallResourceResponseSender
			err := app.CallResource(context.Background(), &backend.CallResourceRequest{
				Method:        http.MethodPost,
				Path:          tc.path,
				Body:          tc.body,
				Headers:       tc.headers,
				PluginContext: tc.pluginCtx,
			}, &sender)
			if err != nil {
				t.Fatalf("CallResource error: %s", err)
			}
			if sender.response == nil {
				t.Fatal("no response received from CallResource")
			}
			if sender.response.Status != tc.expStatus {
				t.Fatalf("expected status %d, got %d body=%s", tc.expStatus, sender.response.Status, sender.response.Body)
			}
			if tb := bytes.TrimSpace(sender.response.Body); !bytes.Equal(tb, tc.body) {
				t.Fatalf("response body should echo request body, got %s", tb)
			}
		})
	}
}

func TestNewAppDefaultsToSigilServiceURL(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}

	app := inst.(*App)
	if app.apiURL != defaultSigilAPIURL {
		t.Fatalf("expected default api URL %q, got %q", defaultSigilAPIURL, app.apiURL)
	}
}

func TestCallResourceForwardsTenantAndAuthHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Scope-OrgID"); got != "tenant-a" {
			http.Error(w, "missing tenant", http.StatusUnauthorized)
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer token-a" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"items":[]}`)
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.apiURL = upstream.URL

	var sender mockCallResourceResponseSender
	err = app.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations",
		Headers: map[string][]string{
			"X-Scope-OrgID": []string{"tenant-a"},
			"Authorization": []string{"Bearer token-a"},
		},
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}

	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, sender.response.Status)
	}
}

func TestCallResourceForwardsQueryString(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "limit=10&cursor=next-token" {
			http.Error(w, "missing query string", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"items":[]}`)
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.apiURL = upstream.URL

	var sender mockCallResourceResponseSender
	err = app.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations?limit=10&cursor=next-token",
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, sender.response.Status)
	}
}

func TestCallResourceReturnsNon200StubOnProxyFailures(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)

	for _, tc := range []struct {
		name           string
		apiURL         string
		expectedStatus int
	}{
		{
			name:           "invalid upstream URL",
			apiURL:         "http://[::1",
			expectedStatus: http.StatusInternalServerError,
		},
		{
			name:           "upstream unavailable",
			apiURL:         "http://127.0.0.1:1",
			expectedStatus: http.StatusBadGateway,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app.apiURL = tc.apiURL

			var sender mockCallResourceResponseSender
			err = app.CallResource(context.Background(), &backend.CallResourceRequest{
				Method: http.MethodGet,
				Path:   "query/conversations",
			}, &sender)
			if err != nil {
				t.Fatalf("CallResource error: %s", err)
			}
			if sender.response == nil {
				t.Fatal("no response received from CallResource")
			}
			if sender.response.Status != tc.expectedStatus {
				t.Fatalf("expected status %d, got %d", tc.expectedStatus, sender.response.Status)
			}

			var body stubResponse
			if err := json.Unmarshal(sender.response.Body, &body); err != nil {
				t.Fatalf("unmarshal stub response: %v", err)
			}
			if body.Status != "stub" {
				t.Fatalf("expected stub response, got %q", body.Status)
			}
		})
	}
}
