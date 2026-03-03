package plugin

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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
		case "/api/v1/conversations/search":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"conversations":[],"next_cursor":"","has_more":false}`)
		case "/api/v1/conversations/c-1":
			_, _ = io.WriteString(w, `{"conversation_id":"c-1"}`)
		case "/api/v1/generations/gen-1":
			_, _ = io.WriteString(w, `{"generation_id":"gen-1"}`)
		case "/api/v1/search/tags":
			_, _ = io.WriteString(w, `{"tags":[{"key":"model","scope":"well-known"}]}`)
		case "/api/v1/search/tag/model/values":
			_, _ = io.WriteString(w, `{"values":["gpt-4o"]}`)
		case "/api/v1/search/tag/resource.k8s.label.app/kubernetes/io/name/values":
			if !strings.Contains(r.RequestURI, "resource.k8s.label.app%2Fkubernetes%2Fio%2Fname") {
				http.Error(w, "tag key must stay URL-escaped in upstream request", http.StatusBadRequest)
				return
			}
			_, _ = io.WriteString(w, `{"values":["sigil"]}`)
		case "/api/datasources/uid/prometheus/resources/api/v1/query":
			if got := r.Header.Get("Authorization"); got != "Bearer sa-token" {
				http.Error(w, "missing authorization", http.StatusUnauthorized)
				return
			}
			_, _ = io.WriteString(w, `{"status":"success"}`)
		case "/api/datasources/proxy/uid/tempo/api/search":
			if got := r.Header.Get("Authorization"); got != "Bearer sa-token" {
				http.Error(w, "missing authorization", http.StatusUnauthorized)
				return
			}
			_, _ = io.WriteString(w, `{"traces":[]}`)
		case "/api/datasources/proxy/uid/tempo/api/traces/t-1":
			if got := r.Header.Get("Authorization"); got != "Bearer sa-token" {
				http.Error(w, "missing authorization", http.StatusUnauthorized)
				return
			}
			_, _ = io.WriteString(w, `{"traceID":"t-1"}`)
		case "/api/v1/conversations/c-1/ratings":
			if r.Method == http.MethodPost {
				body, _ := io.ReadAll(r.Body)
				_, _ = w.Write(body)
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
				_, _ = w.Write(body)
				return
			}
			_, _ = io.WriteString(w, `{"items":[{"annotation_id":"ann-1"}]}`)
		case "/api/v1/model-cards":
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if resolvePairs := r.URL.Query()["resolve_pair"]; len(resolvePairs) > 0 {
				if len(resolvePairs) != 2 ||
					resolvePairs[0] != "openai:gpt-4o" ||
					resolvePairs[1] != "anthropic:claude-sonnet-4-5" {
					http.Error(w, "unexpected resolve_pair query params", http.StatusBadRequest)
					return
				}
				_, _ = io.WriteString(w, `{"resolved":[{"provider":"openai","model":"gpt-4o","status":"resolved"}],"freshness":{"stale":false}}`)
				return
			}
			_, _ = io.WriteString(w, `{"data":[{"model_key":"openrouter:openai/gpt-4o"}],"next_cursor":"","freshness":{"stale":false}}`)
		case "/api/v1/model-cards:lookup":
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"data":{"model_key":"openrouter:openai/gpt-4o"},"freshness":{"stale":false}}`)
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
	app.grafanaAppURL = upstream.URL
	app.grafanaServiceAccountToken = "sa-token"
	app.prometheusDatasourceUID = "prometheus"
	app.tempoDatasourceUID = "tempo"

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
			expBody:   []byte(`{"conversation_id":"c-1"}`),
		},
		{
			name:      "search conversations",
			method:    http.MethodPost,
			path:      "query/conversations/search",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"conversations":[],"next_cursor":"","has_more":false}`),
		},
		{
			name:      "get generation by id",
			method:    http.MethodGet,
			path:      "query/generations/gen-1",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"generation_id":"gen-1"}`),
		},
		{
			name:      "list search tags",
			method:    http.MethodGet,
			path:      "query/search/tags",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"tags":[{"key":"model","scope":"well-known"}]}`),
		},
		{
			name:      "list search tag values",
			method:    http.MethodGet,
			path:      "query/search/tag/model/values",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"values":["gpt-4o"]}`),
		},
		{
			name:      "list search tag values with escaped slashes",
			method:    http.MethodGet,
			path:      "query/search/tag/resource.k8s.label.app%2Fkubernetes%2Fio%2Fname/values",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"values":["sigil"]}`),
		},
		{
			name:      "list search tag values with decoded slashes",
			method:    http.MethodGet,
			path:      "query/search/tag/resource.k8s.label.app/kubernetes/io/name/values",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"values":["sigil"]}`),
		},
		{
			name:      "query proxy prometheus",
			method:    http.MethodGet,
			path:      "query/proxy/prometheus/api/v1/query",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"status":"success"}`),
		},
		{
			name:      "query proxy tempo search",
			method:    http.MethodGet,
			path:      "query/proxy/tempo/api/search",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"traces":[]}`),
		},
		{
			name:      "query proxy tempo trace detail",
			method:    http.MethodGet,
			path:      "query/proxy/tempo/api/traces/t-1",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"traceID":"t-1"}`),
		},
		{
			name:      "generation post not allowed",
			method:    http.MethodPost,
			path:      "query/generations/gen-1",
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
			name:      "list model cards",
			method:    http.MethodGet,
			path:      "query/model-cards",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"data":[{"model_key":"openrouter:openai/gpt-4o"}],"next_cursor":"","freshness":{"stale":false}}`),
		},
		{
			name:      "lookup model card",
			method:    http.MethodGet,
			path:      "query/model-cards/lookup?model_key=openrouter%3Aopenai%2Fgpt-4o",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"data":{"model_key":"openrouter:openai/gpt-4o"},"freshness":{"stale":false}}`),
		},
		{
			name:      "resolve model cards with repeated params",
			method:    http.MethodGet,
			path:      "query/model-cards?resolve_pair=openai%3Agpt-4o&resolve_pair=anthropic%3Aclaude-sonnet-4-5",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"resolved":[{"provider":"openai","model":"gpt-4o","status":"resolved"}],"freshness":{"stale":false}}`),
		},
		{
			name:      "model cards post not allowed",
			method:    http.MethodPost,
			path:      "query/model-cards",
			expStatus: http.StatusMethodNotAllowed,
		},
		{
			name:      "legacy completions route removed",
			method:    http.MethodGet,
			path:      "query/completions",
			expStatus: http.StatusNotFound,
		},
		{
			name:      "legacy traces route removed",
			method:    http.MethodGet,
			path:      "query/traces/t-1",
			expStatus: http.StatusNotFound,
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

func TestCallResourceSupportsProxyPrometheusPostPassThrough(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/datasources/uid/prometheus/resources/api/v1/query":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if got := r.Header.Get("Authorization"); got != "Bearer sa-token" {
				http.Error(w, "missing authorization", http.StatusUnauthorized)
				return
			}
			body, _ := io.ReadAll(r.Body)
			_, _ = w.Write(body)
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
	app.grafanaAppURL = upstream.URL
	app.grafanaServiceAccountToken = "sa-token"
	app.prometheusDatasourceUID = "prometheus"

	payload := []byte(`{"query":"sum(rate(http_requests_total[5m]))"}`)
	var sender mockCallResourceResponseSender
	err = app.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/proxy/prometheus/api/v1/query",
		Body:   payload,
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.response.Status, sender.response.Body)
	}
	if tb := bytes.TrimSpace(sender.response.Body); !bytes.Equal(tb, payload) {
		t.Fatalf("response body should echo request body, got %s", tb)
	}
}

func TestCallResourceProxyFallsBackToForwardedAuthWhenServiceAccountMissing(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/datasources/uid/prometheus/resources/api/v1/query":
			if got := r.Header.Get("Authorization"); got != "Bearer user-token" {
				http.Error(w, "missing forwarded authorization", http.StatusUnauthorized)
				return
			}
			_, _ = io.WriteString(w, `{"status":"success"}`)
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
	app.grafanaAppURL = upstream.URL
	app.prometheusDatasourceUID = "prometheus"
	app.grafanaServiceAccountToken = ""

	var sender mockCallResourceResponseSender
	err = app.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/proxy/prometheus/api/v1/query",
		Headers: map[string][]string{
			"Authorization": {"Bearer user-token"},
		},
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.response.Status, sender.response.Body)
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
			_, _ = w.Write(body)
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
			_, _ = w.Write(body)
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
	if app.tenantID != defaultTenantID {
		t.Fatalf("expected default tenant id %q, got %q", defaultTenantID, app.tenantID)
	}
}

func TestCallResourceInjectsFallbackTenantHeader(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Scope-OrgID"); got != defaultTenantID {
			http.Error(w, "missing fallback tenant", http.StatusUnauthorized)
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
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.response.Status, sender.response.Body)
	}
}

func TestCallResourceIgnoresGrafanaOrgHeaderAndUsesFallbackTenant(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Scope-OrgID"); got != defaultTenantID {
			http.Error(w, "missing fallback tenant", http.StatusUnauthorized)
			return
		}
		if got := r.Header.Get("X-Grafana-Org-Id"); got != "12" {
			http.Error(w, "missing grafana org header passthrough", http.StatusUnauthorized)
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
			"X-Grafana-Org-Id": {"12"},
		},
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.response.Status, sender.response.Body)
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
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/conversations":
			if r.URL.RawQuery != "limit=10&cursor=next-token" {
				http.Error(w, "missing conversations query string", http.StatusBadRequest)
				return
			}
			_, _ = io.WriteString(w, `{"items":[]}`)
		case "/api/datasources/proxy/uid/tempo/api/search":
			if r.URL.RawQuery != "q=service.name%3Dapi&limit=20" {
				http.Error(w, "missing tempo query string", http.StatusBadRequest)
				return
			}
			if got := r.Header.Get("Authorization"); got != "Bearer sa-token" {
				http.Error(w, "missing authorization", http.StatusUnauthorized)
				return
			}
			_, _ = io.WriteString(w, `{"traces":[]}`)
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
	app.grafanaAppURL = upstream.URL
	app.grafanaServiceAccountToken = "sa-token"
	app.tempoDatasourceUID = "tempo"

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

	err = app.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/proxy/tempo/api/search?q=service.name%3Dapi&limit=20",
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

func TestCallResourceRejectsInvalidProxyPath(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.grafanaAppURL = "http://grafana:3000"
	app.grafanaServiceAccountToken = "sa-token"
	app.prometheusDatasourceUID = "prometheus"
	app.tempoDatasourceUID = "tempo"

	for _, path := range []string{
		"query/proxy/prometheus/",
		"query/proxy/tempo/",
	} {
		t.Run(path, func(t *testing.T) {
			var sender mockCallResourceResponseSender
			err := app.CallResource(context.Background(), &backend.CallResourceRequest{
				Method: http.MethodGet,
				Path:   path,
			}, &sender)
			if err != nil {
				t.Fatalf("CallResource error: %s", err)
			}
			if sender.response == nil {
				t.Fatal("no response received from CallResource")
			}
			if sender.response.Status != http.StatusBadRequest {
				t.Fatalf("expected status %d, got %d", http.StatusBadRequest, sender.response.Status)
			}
		})
	}
}

func TestCallResourceRejectsProxyWhenGrafanaDatasourceConfigMissing(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)

	var sender mockCallResourceResponseSender
	err = app.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/proxy/tempo/api/search",
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusServiceUnavailable, sender.response.Status, sender.response.Body)
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

func TestCallResourceReturnsValidJSONWhenClientSendsAcceptEncodingGzip(t *testing.T) {
	// Upstream responds with gzip when it sees Accept-Encoding: gzip.
	// Go's http.Transport adds Accept-Encoding: gzip automatically when
	// the user-provided header is stripped, and then transparently
	// decompresses the response. This test verifies the proxy returns
	// valid JSON instead of garbled gzip bytes.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			w.Header().Set("Content-Encoding", "gzip")
			gz := gzip.NewWriter(w)
			_, _ = gz.Write([]byte(`{"items":[]}`))
			_ = gz.Close()
			return
		}
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
			"Accept-Encoding": {"gzip"},
		},
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.response.Status, sender.response.Body)
	}
	// Verify the response body is valid JSON, not garbled gzip bytes.
	var result map[string]interface{}
	if err := json.Unmarshal(sender.response.Body, &result); err != nil {
		t.Fatalf("response body is not valid JSON (garbled encoding?): %v\nbody bytes: %x", err, sender.response.Body)
	}
}

func TestCallResourceRoutesTempoProxyThroughGrafanaDatasourceProxy(t *testing.T) {
	grafana := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/datasources/proxy/uid/tempo-ds/api/search" {
			http.Error(w, "unexpected path", http.StatusBadRequest)
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sa-token" {
			http.Error(w, "missing authorization", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"traces":[]}`)
	}))
	defer grafana.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.grafanaAppURL = grafana.URL
	app.grafanaServiceAccountToken = "sa-token"
	app.tempoDatasourceUID = "tempo-ds"

	var sender mockCallResourceResponseSender
	err = app.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/proxy/tempo/api/search",
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.response.Status, sender.response.Body)
	}
	if tb := bytes.TrimSpace(sender.response.Body); !bytes.Equal(tb, []byte(`{"traces":[]}`)) {
		t.Fatalf("unexpected response body: %s", tb)
	}
}

func TestCallResourceInjectsBasicAuthOnSigilProxy(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "tenant-42" || pass != "sigil-token" {
			http.Error(w, "expected basic auth tenant-42:sigil-token", http.StatusUnauthorized)
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
	app.tenantID = "tenant-42"
	app.apiAuthToken = "sigil-token"

	var sender mockCallResourceResponseSender
	err = app.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations",
		Headers: map[string][]string{
			"Authorization": {"Bearer user-token"},
		},
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.response.Status, sender.response.Body)
	}
}

func TestNewAppReadsApiAuthTokenFromSecureJsonData(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
		JSONData: []byte(`{"sigilApiUrl":"https://remote.example.com","tenantId":"42"}`),
		DecryptedSecureJSONData: map[string]string{
			"sigilApiAuthToken": "secret-token",
		},
	})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}

	app := inst.(*App)
	if app.apiURL != "https://remote.example.com" {
		t.Fatalf("expected api URL %q, got %q", "https://remote.example.com", app.apiURL)
	}
	if app.tenantID != "42" {
		t.Fatalf("expected tenant id %q, got %q", "42", app.tenantID)
	}
	if app.apiAuthToken != "secret-token" {
		t.Fatalf("expected api auth token %q, got %q", "secret-token", app.apiAuthToken)
	}
}

func TestCallResourceSettingsRoutesProxyToSigil(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/settings" {
			http.Error(w, "unexpected path", http.StatusBadRequest)
			return
		}
		if got := r.Header.Get("X-Scope-OrgID"); got != "fake" {
			http.Error(w, "missing tenant", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"datasources":{"prometheusDatasourceUID":"prom","tempoDatasourceUID":"tempo"}}`)
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
		Path:   "query/settings",
	}, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	if sender.response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.response.Status, sender.response.Body)
	}
}
