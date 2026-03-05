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

	"github.com/grafana/authlib/authz"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

type mockCallResourceResponseSender struct {
	response *backend.CallResourceResponse
}

func (s *mockCallResourceResponseSender) Send(response *backend.CallResourceResponse) error {
	s.response = response
	return nil
}

func callResource(t *testing.T, app *App, req *backend.CallResourceRequest) *backend.CallResourceResponse {
	t.Helper()

	var sender mockCallResourceResponseSender
	err := app.CallResource(context.Background(), req, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if sender.response == nil {
		t.Fatal("no response received from CallResource")
	}
	return sender.response
}

func callResourceWithAuth(t *testing.T, app *App, req *backend.CallResourceRequest) *backend.CallResourceResponse {
	t.Helper()

	if req.Headers == nil {
		req.Headers = map[string][]string{}
	}
	if _, ok := req.Headers["X-Grafana-Id"]; !ok {
		req.Headers["X-Grafana-Id"] = []string{"test-id-token"}
	}

	return callResource(t, app, req)
}

type mockAuthzClient struct {
	allowed map[string]bool
}

func newMockAuthzClient(allowed map[string]bool) *mockAuthzClient {
	return &mockAuthzClient{allowed: allowed}
}

func (m *mockAuthzClient) HasAccess(_ context.Context, _ string, action string, _ ...authz.Resource) (bool, error) {
	return m.allowed[action], nil
}

func allowAllSigilActions() map[string]bool {
	return map[string]bool{
		permissionDataRead:      true,
		permissionFeedbackWrite: true,
		permissionSettingsWrite: true,
		permissionEvalWrite:     true,
	}
}

func TestRequiredPermissionAction(t *testing.T) {
	t.Run("read routes", func(t *testing.T) {
		testCases := []struct {
			method string
			path   string
		}{
			{method: http.MethodGet, path: "/query/conversations"},
			{method: http.MethodPost, path: "/query/conversations/search"},
			{method: http.MethodGet, path: "/query/conversations/c-1"},
			{method: http.MethodGet, path: "/query/conversations/c-1/ratings"},
			{method: http.MethodGet, path: "/query/conversations/c-1/annotations"},
			{method: http.MethodGet, path: "/query/generations/gen-1"},
			{method: http.MethodGet, path: "/query/search/tags"},
			{method: http.MethodGet, path: "/query/search/tag/model/values"},
			{method: http.MethodGet, path: "/query/settings"},
			{method: http.MethodGet, path: "/query/proxy/prometheus/api/v1/query"},
			{method: http.MethodPost, path: "/query/proxy/prometheus/api/v1/query"},
			{method: http.MethodGet, path: "/query/proxy/tempo/api/search"},
			{method: http.MethodGet, path: "/query/model-cards"},
			{method: http.MethodGet, path: "/query/model-cards/lookup"},
			{method: http.MethodGet, path: "/query/agents"},
			{method: http.MethodGet, path: "/query/agents/lookup"},
			{method: http.MethodGet, path: "/query/agents/versions"},
			// Eval read routes
			{method: http.MethodGet, path: "/eval/evaluators"},
			{method: http.MethodGet, path: "/eval/evaluators/prod.helpfulness.v1"},
			{method: http.MethodGet, path: "/eval/predefined/evaluators"},
			{method: http.MethodGet, path: "/eval/rules"},
			{method: http.MethodGet, path: "/eval/rules/online.helpfulness"},
			{method: http.MethodGet, path: "/eval/judge/providers"},
			{method: http.MethodGet, path: "/eval/judge/models"},
			{method: http.MethodGet, path: "/eval/templates"},
			{method: http.MethodGet, path: "/eval/templates/my-template"},
			{method: http.MethodGet, path: "/eval/saved-conversations"},
			{method: http.MethodGet, path: "/eval/saved-conversations/sc-1"},
		}

		for _, tc := range testCases {
			action, ok := requiredPermissionAction(tc.method, tc.path)
			if !ok {
				t.Fatalf("expected permission action for %s %s", tc.method, tc.path)
			}
			if action != permissionDataRead {
				t.Fatalf("expected %s for %s %s, got %s", permissionDataRead, tc.method, tc.path, action)
			}
		}
	})

	t.Run("feedback write routes", func(t *testing.T) {
		for _, path := range []string{
			"/query/conversations/c-1/ratings",
			"/query/conversations/c-1/annotations",
		} {
			action, ok := requiredPermissionAction(http.MethodPost, path)
			if !ok {
				t.Fatalf("expected permission action for POST %s", path)
			}
			if action != permissionFeedbackWrite {
				t.Fatalf("expected %s for POST %s, got %s", permissionFeedbackWrite, path, action)
			}
		}
	})

	t.Run("settings write route", func(t *testing.T) {
		action, ok := requiredPermissionAction(http.MethodPut, "/query/settings/datasources")
		if !ok {
			t.Fatal("expected permission action for PUT /query/settings/datasources")
		}
		if action != permissionSettingsWrite {
			t.Fatalf("expected %s, got %s", permissionSettingsWrite, action)
		}
	})

	t.Run("eval write routes", func(t *testing.T) {
		testCases := []struct {
			method string
			path   string
		}{
			{method: http.MethodPost, path: "/eval/evaluators"},
			{method: http.MethodPost, path: "/eval/predefined/evaluators/sigil.helpfulness"},
			{method: http.MethodPost, path: "/eval/rules:preview"},
			{method: http.MethodPost, path: "/eval:test"},
			{method: http.MethodPost, path: "/eval/rules"},
			{method: http.MethodDelete, path: "/eval/evaluators/prod.helpfulness.v1"},
			{method: http.MethodDelete, path: "/eval/rules/online.helpfulness"},
			{method: http.MethodPost, path: "/eval/templates"},
			{method: http.MethodPost, path: "/eval/templates/my-template/versions"},
			{method: http.MethodDelete, path: "/eval/templates/my-template"},
			{method: http.MethodPost, path: "/eval/saved-conversations"},
			{method: http.MethodPost, path: "/eval/saved-conversations:manual"},
			{method: http.MethodDelete, path: "/eval/saved-conversations/sc-1"},
		}

		for _, tc := range testCases {
			action, ok := requiredPermissionAction(tc.method, tc.path)
			if !ok {
				t.Fatalf("expected permission action for %s %s", tc.method, tc.path)
			}
			if action != permissionEvalWrite {
				t.Fatalf("expected %s for %s %s, got %s", permissionEvalWrite, tc.method, tc.path, action)
			}
		}
	})

	t.Run("unknown or method-mismatch routes are ignored", func(t *testing.T) {
		testCases := []struct {
			method string
			path   string
		}{
			{method: http.MethodPost, path: "/query/generations/gen-1"},
			{method: http.MethodGet, path: "/query/settings/datasources"},
			{method: http.MethodGet, path: "/unknown"},
		}

		for _, tc := range testCases {
			if _, ok := requiredPermissionAction(tc.method, tc.path); ok {
				t.Fatalf("did not expect permission action for %s %s", tc.method, tc.path)
			}
		}
	})
}

func TestAuthorizationDeniesMissingToken(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.apiURL = upstream.URL
	app.authzClient = newMockAuthzClient(allowAllSigilActions())

	response := callResource(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations",
	})
	if response.Status != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d", http.StatusForbidden, response.Status)
	}
}

func TestAuthorizationRouteSpecificPermissions(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/conversations/c-1/ratings":
			if r.Method == http.MethodPost {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"ok":true}`))
				return
			}
		case "/api/v1/settings/datasources":
			if r.Method == http.MethodPut {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"ok":true}`))
				return
			}
		}
		http.NotFound(w, r)
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.apiURL = upstream.URL

	t.Run("reader cannot write feedback", func(t *testing.T) {
		app.authzClient = newMockAuthzClient(map[string]bool{
			permissionDataRead: true,
		})

		response := callResourceWithAuth(t, app, &backend.CallResourceRequest{
			Method: http.MethodPost,
			Path:   "query/conversations/c-1/ratings",
			Body:   []byte(`{"rating":"CONVERSATION_RATING_VALUE_GOOD"}`),
			Headers: map[string][]string{
				"X-Grafana-Id": {"reader-token"},
			},
		})
		if response.Status != http.StatusForbidden {
			t.Fatalf("expected status %d, got %d", http.StatusForbidden, response.Status)
		}
	})

	t.Run("feedback writer can write feedback", func(t *testing.T) {
		app.authzClient = newMockAuthzClient(map[string]bool{
			permissionFeedbackWrite: true,
		})

		response := callResourceWithAuth(t, app, &backend.CallResourceRequest{
			Method: http.MethodPost,
			Path:   "query/conversations/c-1/ratings",
			Body:   []byte(`{"rating":"CONVERSATION_RATING_VALUE_GOOD"}`),
			Headers: map[string][]string{
				"X-Grafana-Id": {"feedback-writer-token"},
			},
		})
		if response.Status != http.StatusOK {
			t.Fatalf("expected status %d, got %d", http.StatusOK, response.Status)
		}
	})

	t.Run("reader cannot write settings", func(t *testing.T) {
		app.authzClient = newMockAuthzClient(map[string]bool{
			permissionDataRead: true,
		})

		response := callResourceWithAuth(t, app, &backend.CallResourceRequest{
			Method: http.MethodPut,
			Path:   "query/settings/datasources",
			Body:   []byte(`{"datasources":{"prometheusDatasourceUID":"prom"}}`),
			Headers: map[string][]string{
				"X-Grafana-Id": {"reader-token"},
			},
		})
		if response.Status != http.StatusForbidden {
			t.Fatalf("expected status %d, got %d", http.StatusForbidden, response.Status)
		}
	})

	t.Run("sigil admin can write settings", func(t *testing.T) {
		app.authzClient = newMockAuthzClient(map[string]bool{
			permissionSettingsWrite: true,
		})

		response := callResourceWithAuth(t, app, &backend.CallResourceRequest{
			Method: http.MethodPut,
			Path:   "query/settings/datasources",
			Body:   []byte(`{"datasources":{"prometheusDatasourceUID":"prom"}}`),
			Headers: map[string][]string{
				"X-Grafana-Id": {"sigil-admin-token"},
			},
		})
		if response.Status != http.StatusOK {
			t.Fatalf("expected status %d, got %d", http.StatusOK, response.Status)
		}
	})

	t.Run("GET settings/datasources is rejected regardless of permissions", func(t *testing.T) {
		app.authzClient = newMockAuthzClient(allowAllSigilActions())

		response := callResourceWithAuth(t, app, &backend.CallResourceRequest{
			Method: http.MethodGet,
			Path:   "query/settings/datasources",
			Headers: map[string][]string{
				"X-Grafana-Id": {"sigil-admin-token"},
			},
		})
		if response.Status != http.StatusMethodNotAllowed {
			t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, response.Status)
		}
	})
}

func TestCallResource(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/conversations":
			_, _ = io.WriteString(w, `{"items":[]}`)
		case "/api/v1/conversations:batch-metadata":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			var payload struct {
				ConversationIDs []string `json:"conversation_ids"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			if len(payload.ConversationIDs) == 0 {
				http.Error(w, "missing conversation ids", http.StatusBadRequest)
				return
			}
			_, _ = io.WriteString(w, `{"items":[{"conversation_id":"conv-1","generation_count":2,"first_generation_at":"2026-02-15T08:00:00Z","last_generation_at":"2026-02-15T09:00:00Z","annotation_count":0}],"missing_conversation_ids":[]}`)
		case "/api/v1/conversations/c-1":
			_, _ = io.WriteString(w, `{"conversation_id":"c-1"}`)
		case "/api/v1/generations/gen-1":
			_, _ = io.WriteString(w, `{"generation_id":"gen-1"}`)
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
			if strings.TrimSpace(r.URL.Query().Get("q")) != "" {
				if got := r.Header.Get("X-Scope-OrgID"); got != defaultTenantID {
					http.Error(w, "missing fallback tenant header on tempo search", http.StatusUnauthorized)
					return
				}
				_, _ = io.WriteString(w, `{"traces":[{"traceID":"trace-1","startTimeUnixNano":"1739612400000000000","spanSets":[{"spans":[{"spanID":"span-1","durationNanos":"1000000000","attributes":[{"key":"sigil.generation.id","value":{"stringValue":"gen-1"}},{"key":"gen_ai.conversation.id","value":{"stringValue":"conv-1"}},{"key":"gen_ai.request.model","value":{"stringValue":"gpt-4o"}},{"key":"gen_ai.agent.name","value":{"stringValue":"assistant"}},{"key":"user.id","value":{"stringValue":"user-42"}}]}]}]}]}`)
				return
			}
			_, _ = io.WriteString(w, `{"traces":[]}`)
		case "/api/datasources/proxy/uid/tempo/api/v2/search/tags":
			if got := r.Header.Get("Authorization"); got != "Bearer sa-token" {
				http.Error(w, "missing authorization", http.StatusUnauthorized)
				return
			}
			if got := r.Header.Get("X-Scope-OrgID"); got != defaultTenantID {
				http.Error(w, "missing fallback tenant header on tempo tags", http.StatusUnauthorized)
				return
			}
			switch r.URL.Query().Get("scope") {
			case "span":
				_, _ = io.WriteString(w, `{"tagNames":["gen_ai.request.model"]}`)
			case "resource":
				_, _ = io.WriteString(w, `{"tagNames":["k8s.namespace.name"]}`)
			default:
				http.Error(w, "missing scope", http.StatusBadRequest)
			}
		case "/api/datasources/proxy/uid/tempo/api/v2/search/tag/span.gen_ai.request.model/values":
			if got := r.Header.Get("X-Scope-OrgID"); got != defaultTenantID {
				http.Error(w, "missing fallback tenant header on tempo tag values", http.StatusUnauthorized)
				return
			}
			_, _ = io.WriteString(w, `{"values":["gpt-4o"]}`)
		case "/api/datasources/proxy/uid/tempo/api/v2/search/tag/resource.k8s.label.app/kubernetes/io/name/values":
			if got := r.Header.Get("X-Scope-OrgID"); got != defaultTenantID {
				http.Error(w, "missing fallback tenant header on tempo tag values", http.StatusUnauthorized)
				return
			}
			if !strings.Contains(r.RequestURI, "resource.k8s.label.app%2Fkubernetes%2Fio%2Fname") {
				http.Error(w, "tag key must stay URL-escaped in upstream request", http.StatusBadRequest)
				return
			}
			_, _ = io.WriteString(w, `{"values":["sigil"]}`)
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
		case "/api/v1/agents":
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"items":[{"agent_name":"assistant"}],"next_cursor":""}`)
		case "/api/v1/agents:lookup":
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"agent_name":"assistant","effective_version":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`)
		case "/api/v1/agents:versions":
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"items":[{"effective_version":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],"next_cursor":""}`)
		case "/api/v1/eval/evaluators":
			switch r.Method {
			case http.MethodGet:
				_, _ = io.WriteString(w, `{"items":[],"next_cursor":""}`)
			case http.MethodPost:
				body, _ := io.ReadAll(r.Body)
				_, _ = w.Write(body)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		case "/api/v1/eval/evaluators/eval-1":
			switch r.Method {
			case http.MethodGet:
				_, _ = io.WriteString(w, `{"evaluator_id":"eval-1"}`)
			case http.MethodDelete:
				w.WriteHeader(http.StatusNoContent)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		case "/api/v1/eval/predefined/evaluators":
			_, _ = io.WriteString(w, `{"items":[{"evaluator_id":"sigil.helpfulness"}]}`)
		case "/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			body, _ := io.ReadAll(r.Body)
			_, _ = w.Write(body)
		case "/api/v1/eval/rules":
			switch r.Method {
			case http.MethodGet:
				_, _ = io.WriteString(w, `{"items":[],"next_cursor":""}`)
			case http.MethodPost:
				body, _ := io.ReadAll(r.Body)
				_, _ = w.Write(body)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		case "/api/v1/eval/rules/rule-1":
			switch r.Method {
			case http.MethodGet:
				_, _ = io.WriteString(w, `{"rule_id":"rule-1"}`)
			case http.MethodPatch:
				body, _ := io.ReadAll(r.Body)
				_, _ = w.Write(body)
			case http.MethodDelete:
				w.WriteHeader(http.StatusNoContent)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		case "/api/v1/eval/rules/dsodsjodss/doidsnoids":
			// Rule ID contains slash; backend uses RawPath. Plugin must forward with %2F encoded.
			if !strings.Contains(r.RequestURI, "dsodsjodss%2Fdoidsnoids") {
				http.Error(w, "rule id with slash must be path-encoded in upstream request", http.StatusBadRequest)
				return
			}
			if r.Method != http.MethodDelete {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case "/api/v1/eval/rules:preview":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"window_hours":6,"total_generations":100,"matching_generations":10,"sampled_generations":1,"samples":[]}`)
		case "/api/v1/eval/judge/providers":
			_, _ = io.WriteString(w, `{"providers":[{"id":"openai","name":"OpenAI","type":"direct"}]}`)
		case "/api/v1/eval/judge/models":
			_, _ = io.WriteString(w, `{"models":[{"id":"gpt-4o-mini","name":"gpt-4o-mini","provider":"openai"}]}`)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL
	app.grafanaAppURL = upstream.URL
	app.grafanaServiceAccountToken = "sa-token"
	app.prometheusDatasourceUID = "prometheus"
	app.tempoDatasourceUID = "tempo"

	for _, tc := range []struct {
		name            string
		method          string
		path            string
		reqBody         []byte
		expStatus       int
		expBody         []byte
		expBodyContains []string
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
			reqBody:   []byte(`{"filters":"model=\"gpt-4o\"","time_range":{"from":"2026-02-14T00:00:00Z","to":"2026-02-16T00:00:00Z"},"page_size":20}`),
			expBodyContains: []string{
				`"conversation_id":"conv-1"`,
				`"user_id":"user-42"`,
				`"has_more":false`,
			},
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
			expBodyContains: []string{
				`"key":"model"`,
				`"scope":"well-known"`,
			},
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
			name:      "list agents",
			method:    http.MethodGet,
			path:      "query/agents",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"items":[{"agent_name":"assistant"}],"next_cursor":""}`),
		},
		{
			name:      "lookup agent",
			method:    http.MethodGet,
			path:      "query/agents/lookup?name=assistant",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"agent_name":"assistant","effective_version":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`),
		},
		{
			name:      "list agent versions",
			method:    http.MethodGet,
			path:      "query/agents/versions?name=assistant",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"items":[{"effective_version":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],"next_cursor":""}`),
		},
		{
			name:      "model cards post not allowed",
			method:    http.MethodPost,
			path:      "query/model-cards",
			expStatus: http.StatusMethodNotAllowed,
		},
		{
			name:      "list evaluators",
			method:    http.MethodGet,
			path:      "eval/evaluators",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"items":[],"next_cursor":""}`),
		},
		{
			name:      "get evaluator by id",
			method:    http.MethodGet,
			path:      "eval/evaluators/eval-1",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"evaluator_id":"eval-1"}`),
		},
		{
			name:      "delete evaluator",
			method:    http.MethodDelete,
			path:      "eval/evaluators/eval-1",
			expStatus: http.StatusNoContent,
		},
		{
			name:      "list predefined evaluators",
			method:    http.MethodGet,
			path:      "eval/predefined/evaluators",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"items":[{"evaluator_id":"sigil.helpfulness"}]}`),
		},
		{
			name:      "list rules",
			method:    http.MethodGet,
			path:      "eval/rules",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"items":[],"next_cursor":""}`),
		},
		{
			name:      "get rule by id",
			method:    http.MethodGet,
			path:      "eval/rules/rule-1",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"rule_id":"rule-1"}`),
		},
		{
			name:      "delete rule",
			method:    http.MethodDelete,
			path:      "eval/rules/rule-1",
			expStatus: http.StatusNoContent,
		},
		{
			name:      "delete rule with id containing slash",
			method:    http.MethodDelete,
			path:      "eval/rules/dsodsjodss%2Fdoidsnoids",
			expStatus: http.StatusNoContent,
		},
		{
			name:      "reject rule path with literal slash",
			method:    http.MethodGet,
			path:      "eval/rules/foo/bar",
			expStatus: http.StatusBadRequest,
		},
		{
			name:      "list judge providers",
			method:    http.MethodGet,
			path:      "eval/judge/providers",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"providers":[{"id":"openai","name":"OpenAI","type":"direct"}]}`),
		},
		{
			name:      "list judge models",
			method:    http.MethodGet,
			path:      "eval/judge/models?provider=openai",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"models":[{"id":"gpt-4o-mini","name":"gpt-4o-mini","provider":"openai"}]}`),
		},
		{
			name:      "evaluators post not allowed via get handler",
			method:    http.MethodPatch,
			path:      "eval/evaluators",
			expStatus: http.StatusMethodNotAllowed,
		},
		{
			name:      "rules put not allowed",
			method:    http.MethodPut,
			path:      "eval/rules/rule-1",
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
			r := callResourceWithAuth(t, app, &backend.CallResourceRequest{
				Method: tc.method,
				Path:   tc.path,
				Body:   tc.reqBody,
			})
			if tc.expStatus != r.Status {
				t.Fatalf("response status should be %d, got %d", tc.expStatus, r.Status)
			}
			if len(tc.expBody) > 0 {
				if tb := bytes.TrimSpace(r.Body); !bytes.Equal(tb, tc.expBody) {
					t.Fatalf("response body should be %s, got %s", tc.expBody, tb)
				}
			}
			for _, fragment := range tc.expBodyContains {
				if !strings.Contains(string(r.Body), fragment) {
					t.Fatalf("response body should contain %q, got %s", fragment, string(r.Body))
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL
	app.grafanaAppURL = upstream.URL
	app.grafanaServiceAccountToken = "sa-token"
	app.prometheusDatasourceUID = "prometheus"

	payload := []byte(`{"query":"sum(rate(http_requests_total[5m]))"}`)
	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/proxy/prometheus/api/v1/query",
		Body:   payload,
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
	}
	if tb := bytes.TrimSpace(sender.Body); !bytes.Equal(tb, payload) {
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.grafanaAppURL = upstream.URL
	app.prometheusDatasourceUID = "prometheus"
	app.grafanaServiceAccountToken = ""

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/proxy/prometheus/api/v1/query",
		Headers: map[string][]string{
			"Authorization": {"Bearer user-token"},
		},
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
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
			sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
				Method:        http.MethodPost,
				Path:          tc.path,
				Body:          tc.body,
				Headers:       tc.headers,
				PluginContext: tc.pluginCtx,
			})
			if sender.Status != tc.expStatus {
				t.Fatalf("expected status %d, got %d body=%s", tc.expStatus, sender.Status, sender.Body)
			}
			if tb := bytes.TrimSpace(sender.Body); !bytes.Equal(tb, tc.body) {
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations",
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
	}
}

func TestCallResourceInjectsTraceparentHeader(t *testing.T) {
	tracerProvider := sdktrace.NewTracerProvider()
	prevTracerProvider := otel.GetTracerProvider()
	prevPropagator := otel.GetTextMapPropagator()
	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		_ = tracerProvider.Shutdown(context.Background())
		otel.SetTracerProvider(prevTracerProvider)
		otel.SetTextMapPropagator(prevPropagator)
	})

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimSpace(r.Header.Get("traceparent")) == "" {
			http.Error(w, "missing traceparent header", http.StatusBadRequest)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations",
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
	}
}

func TestCallResourceSearchTagsInjectsTraceparentHeader(t *testing.T) {
	tracerProvider := sdktrace.NewTracerProvider()
	prevTracerProvider := otel.GetTracerProvider()
	prevPropagator := otel.GetTextMapPropagator()
	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		_ = tracerProvider.Shutdown(context.Background())
		otel.SetTracerProvider(prevTracerProvider)
		otel.SetTextMapPropagator(prevPropagator)
	})

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/datasources/proxy/uid/tempo/api/v2/search/tags" {
			http.NotFound(w, r)
			return
		}
		if strings.TrimSpace(r.Header.Get("traceparent")) == "" {
			http.Error(w, "missing traceparent header", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"tagNames":[]}`)
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.grafanaAppURL = upstream.URL
	app.grafanaServiceAccountToken = "sa-token"
	app.tempoDatasourceUID = "tempo"

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/search/tags",
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations",
		Headers: map[string][]string{
			"X-Grafana-Org-Id": {"12"},
		},
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations",
		Headers: map[string][]string{
			"X-Scope-OrgID": []string{"tenant-a"},
			"Authorization": []string{"Bearer token-a"},
		},
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, sender.Status)
	}
}

func TestCallResourceSearchPreservesExplicitTenantHeaderOnTempoRequests(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/datasources/proxy/uid/tempo/api/v2/search/tags":
			if got := r.Header.Get("X-Scope-OrgID"); got != "tenant-a" {
				http.Error(w, "expected explicit tenant header", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"tagNames":["gen_ai.request.model"]}`)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.grafanaAppURL = upstream.URL
	app.grafanaServiceAccountToken = "sa-token"
	app.tempoDatasourceUID = "tempo"

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/search/tags",
		Headers: map[string][]string{
			"X-Scope-OrgID": {"tenant-a"},
		},
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL
	app.grafanaAppURL = upstream.URL
	app.grafanaServiceAccountToken = "sa-token"
	app.tempoDatasourceUID = "tempo"

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations?limit=10&cursor=next-token",
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, sender.Status)
	}

	sender = callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/proxy/tempo/api/search?q=service.name%3Dapi&limit=20",
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, sender.Status)
	}
}

func TestCallResourceRejectsInvalidProxyPath(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.grafanaAppURL = "http://grafana:3000"
	app.grafanaServiceAccountToken = "sa-token"
	app.prometheusDatasourceUID = "prometheus"
	app.tempoDatasourceUID = "tempo"

	for _, path := range []string{
		"query/proxy/prometheus/",
		"query/proxy/tempo/",
	} {
		t.Run(path, func(t *testing.T) {
			sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
				Method: http.MethodGet,
				Path:   path,
			})
			if sender.Status != http.StatusBadRequest {
				t.Fatalf("expected status %d, got %d", http.StatusBadRequest, sender.Status)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/proxy/tempo/api/search",
	})
	if sender.Status != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusServiceUnavailable, sender.Status, sender.Body)
	}
}

func TestCallResourceReturnsNon200StubOnProxyFailures(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.authzClient = newMockAuthzClient(allowAllSigilActions())

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

			sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
				Method: http.MethodGet,
				Path:   "query/conversations",
			})
			if sender.Status != tc.expectedStatus {
				t.Fatalf("expected status %d, got %d", tc.expectedStatus, sender.Status)
			}

			var body stubResponse
			if err := json.Unmarshal(sender.Body, &body); err != nil {
				t.Fatalf("unmarshal stub response: %v", err)
			}
			if body.Status != "stub" {
				t.Fatalf("expected stub response, got %q", body.Status)
			}
		})
	}
}

func TestCallResourceSupportsEvalWriteOperations(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/eval/evaluators":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			body, _ := io.ReadAll(r.Body)
			_, _ = w.Write(body)
		case "/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			body, _ := io.ReadAll(r.Body)
			_, _ = w.Write(body)
		case "/api/v1/eval/rules":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			body, _ := io.ReadAll(r.Body)
			_, _ = w.Write(body)
		case "/api/v1/eval/rules/rule-1":
			if r.Method != http.MethodPatch {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			body, _ := io.ReadAll(r.Body)
			_, _ = w.Write(body)
		case "/api/v1/eval/rules:preview":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"window_hours":6,"total_generations":100}`)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())

	testCases := []struct {
		name      string
		method    string
		path      string
		body      []byte
		expStatus int
		expBody   []byte
	}{
		{
			name:      "create evaluator",
			method:    http.MethodPost,
			path:      "eval/evaluators",
			body:      []byte(`{"evaluator_id":"my-eval","kind":"llm_judge"}`),
			expStatus: http.StatusOK,
			expBody:   []byte(`{"evaluator_id":"my-eval","kind":"llm_judge"}`),
		},
		{
			name:      "fork predefined evaluator",
			method:    http.MethodPost,
			path:      "eval/predefined/evaluators/sigil.helpfulness:fork",
			body:      []byte(`{"evaluator_id":"prod.helpfulness.v1"}`),
			expStatus: http.StatusOK,
			expBody:   []byte(`{"evaluator_id":"prod.helpfulness.v1"}`),
		},
		{
			name:      "create rule",
			method:    http.MethodPost,
			path:      "eval/rules",
			body:      []byte(`{"rule_id":"my-rule","selector":"user_visible_turn"}`),
			expStatus: http.StatusOK,
			expBody:   []byte(`{"rule_id":"my-rule","selector":"user_visible_turn"}`),
		},
		{
			name:      "update rule",
			method:    http.MethodPatch,
			path:      "eval/rules/rule-1",
			body:      []byte(`{"enabled":true}`),
			expStatus: http.StatusOK,
			expBody:   []byte(`{"enabled":true}`),
		},
		{
			name:      "preview rule",
			method:    http.MethodPost,
			path:      "eval/rules:preview",
			body:      []byte(`{"selector":"user_visible_turn"}`),
			expStatus: http.StatusOK,
			expBody:   []byte(`{"window_hours":6,"total_generations":100}`),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resp := callResourceWithAuth(t, app, &backend.CallResourceRequest{
				Method: tc.method,
				Path:   tc.path,
				Body:   tc.body,
			})
			if resp.Status != tc.expStatus {
				t.Fatalf("expected status %d, got %d body=%s", tc.expStatus, resp.Status, resp.Body)
			}
			if len(tc.expBody) > 0 {
				if tb := bytes.TrimSpace(resp.Body); !bytes.Equal(tb, tc.expBody) {
					t.Fatalf("response body should be %s, got %s", tc.expBody, tb)
				}
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations",
		Headers: map[string][]string{
			"Accept-Encoding": {"gzip"},
		},
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
	}
	// Verify the response body is valid JSON, not garbled gzip bytes.
	var result map[string]interface{}
	if err := json.Unmarshal(sender.Body, &result); err != nil {
		t.Fatalf("response body is not valid JSON (garbled encoding?): %v\nbody bytes: %x", err, sender.Body)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.grafanaAppURL = grafana.URL
	app.grafanaServiceAccountToken = "sa-token"
	app.tempoDatasourceUID = "tempo-ds"

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/proxy/tempo/api/search",
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
	}
	if tb := bytes.TrimSpace(sender.Body); !bytes.Equal(tb, []byte(`{"traces":[]}`)) {
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL
	app.tenantID = "tenant-42"
	app.apiAuthToken = "sigil-token"

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations",
		Headers: map[string][]string{
			"Authorization": {"Bearer user-token"},
		},
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
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

func TestNewAppHandlesNumericTenantID(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
		JSONData: []byte(`{"sigilApiUrl":"https://remote.example.com","tenantId":13}`),
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
	if app.tenantID != "13" {
		t.Fatalf("expected tenant id %q, got %q", "13", app.tenantID)
	}
	if app.apiAuthToken != "secret-token" {
		t.Fatalf("expected api auth token %q, got %q", "secret-token", app.apiAuthToken)
	}
}

func TestParseAuthToken(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantID   string
		wantTok  string
		wantOK   bool
	}{
		{name: "combined format", input: "27821:secret-token", wantID: "27821", wantTok: "secret-token", wantOK: true},
		{name: "combined with whitespace", input: " 27821:secret-token ", wantID: "27821", wantTok: "secret-token", wantOK: true},
		{name: "token with colons", input: "42:part1:part2", wantID: "42", wantTok: "part1:part2", wantOK: true},
		{name: "plain token no colon", input: "secret-token", wantOK: false},
		{name: "empty string", input: "", wantOK: false},
		{name: "colon only", input: ":", wantOK: false},
		{name: "missing tenant", input: ":token", wantOK: false},
		{name: "missing token", input: "42:", wantOK: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotID, gotTok, gotOK := parseAuthToken(tt.input)
			if gotOK != tt.wantOK {
				t.Fatalf("parseAuthToken(%q) ok = %v, want %v", tt.input, gotOK, tt.wantOK)
			}
			if !gotOK {
				return
			}
			if gotID != tt.wantID {
				t.Errorf("parseAuthToken(%q) tenantID = %q, want %q", tt.input, gotID, tt.wantID)
			}
			if gotTok != tt.wantTok {
				t.Errorf("parseAuthToken(%q) token = %q, want %q", tt.input, gotTok, tt.wantTok)
			}
		})
	}
}

func TestNewAppParsesCombinedAuthToken(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
		JSONData: []byte(`{"sigilApiUrl":"https://remote.example.com","tenantId":"ignored"}`),
		DecryptedSecureJSONData: map[string]string{
			"sigilApiAuthToken": "27821:secret-token",
		},
	})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}

	app := inst.(*App)
	if app.tenantID != "27821" {
		t.Fatalf("expected tenant id %q from combined token, got %q", "27821", app.tenantID)
	}
	if app.apiAuthToken != "secret-token" {
		t.Fatalf("expected api auth token %q, got %q", "secret-token", app.apiAuthToken)
	}
}

func TestNewAppFallsBackToJsonDataTenantID(t *testing.T) {
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
		JSONData: []byte(`{"sigilApiUrl":"https://remote.example.com","tenantId":"42"}`),
	})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}

	app := inst.(*App)
	if app.tenantID != "42" {
		t.Fatalf("expected tenant id %q from jsonData fallback, got %q", "42", app.tenantID)
	}
	if app.apiAuthToken != "" {
		t.Fatalf("expected empty api auth token, got %q", app.apiAuthToken)
	}
}

func TestCallResourceInjectsCombinedAuthOnSigilProxy(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "27821" || pass != "secret-token" {
			http.Error(w, "expected basic auth 27821:secret-token", http.StatusUnauthorized)
			return
		}
		if got := r.Header.Get("X-Scope-OrgID"); got != "27821" {
			http.Error(w, "expected X-Scope-OrgID 27821, got "+got, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"items":[]}`)
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{
		DecryptedSecureJSONData: map[string]string{
			"sigilApiAuthToken": "27821:secret-token",
		},
	})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/conversations",
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
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
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/settings",
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
	}
}
