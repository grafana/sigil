package plugin

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/grafana/authlib/authz"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/sigil/sigil/pkg/searchcore"
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

type mockCallResourceStreamSender struct {
	responses []*backend.CallResourceResponse
}

func (s *mockCallResourceStreamSender) Send(response *backend.CallResourceResponse) error {
	s.responses = append(s.responses, response)
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

func callResourceStreamWithAuth(t *testing.T, app *App, req *backend.CallResourceRequest) []*backend.CallResourceResponse {
	t.Helper()

	if req.Headers == nil {
		req.Headers = map[string][]string{}
	}
	if _, ok := req.Headers["X-Grafana-Id"]; !ok {
		req.Headers["X-Grafana-Id"] = []string{"test-id-token"}
	}

	var sender mockCallResourceStreamSender
	err := app.CallResource(context.Background(), req, &sender)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if len(sender.responses) == 0 {
		t.Fatal("no responses received from CallResource")
	}
	return sender.responses
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

type tempoSearchTraceFixture struct {
	TraceID           string
	StartTimeUnixNano string
	ConversationID    string
	GenerationID      string
	Model             string
	Agent             string
	UserID            string
}

func buildTempoSearchResponse(fixtures []tempoSearchTraceFixture) string {
	parts := make([]string, 0, len(fixtures))
	for _, fixture := range fixtures {
		modelAttribute := ""
		if strings.TrimSpace(fixture.Model) != "" {
			modelAttribute = `,{"key":"gen_ai.request.model","value":{"stringValue":"` + fixture.Model + `"}}`
		}
		agentAttribute := ""
		if strings.TrimSpace(fixture.Agent) != "" {
			agentAttribute = `,{"key":"gen_ai.agent.name","value":{"stringValue":"` + fixture.Agent + `"}}`
		}
		userAttribute := ""
		if strings.TrimSpace(fixture.UserID) != "" {
			userAttribute = `,{"key":"user.id","value":{"stringValue":"` + fixture.UserID + `"}}`
		}
		parts = append(parts,
			`{"traceID":"`+fixture.TraceID+`","startTimeUnixNano":"`+fixture.StartTimeUnixNano+`","spanSets":[{"spans":[{"spanID":"span-`+fixture.TraceID+`","durationNanos":"1000000","attributes":[{"key":"sigil.generation.id","value":{"stringValue":"`+fixture.GenerationID+`"}},{"key":"gen_ai.conversation.id","value":{"stringValue":"`+fixture.ConversationID+`"}}`+modelAttribute+agentAttribute+userAttribute+`]}]}]}`,
		)
	}
	return `{"traces":[` + strings.Join(parts, ",") + `]}`
}

func TestRequiredPermissionAction(t *testing.T) {
	t.Run("read routes", func(t *testing.T) {
		testCases := []struct {
			method string
			path   string
		}{
			{method: http.MethodGet, path: "/query/conversations"},
			{method: http.MethodPost, path: "/query/conversations/search"},
			{method: http.MethodPost, path: "/query/conversations/search/stream"},
			{method: http.MethodPost, path: "/query/conversations/stats"},
			{method: http.MethodGet, path: "/query/v2/conversations/c-1"},
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
			{method: http.MethodGet, path: "/query/agents/rating"},
			{method: http.MethodGet, path: "/query/agents/prompt-insights"},
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
			{method: http.MethodPost, path: "/query/agents/rate"},
			{method: http.MethodPost, path: "/query/agents/analyze-prompt"},
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
			_, _ = io.WriteString(w, `{"items":[{"conversation_id":"conv-1","user_id":"user-42","generation_count":2,"first_generation_at":"2026-02-15T08:00:00Z","last_generation_at":"2026-02-15T09:00:00Z","models":["gpt-4o"],"model_providers":{"gpt-4o":"openai"},"agents":["assistant"],"error_count":0,"has_errors":false,"annotation_count":0}],"missing_conversation_ids":[]}`)
		case "/api/v1/conversations/c-1":
			_, _ = io.WriteString(w, `{"conversation_id":"c-1"}`)
		case "/api/v2/conversations/c-1":
			_, _ = io.WriteString(w, `{"conversation_id":"c-1","messages":[],"shared":{}}`)
		case "/api/v1/conversations/conv-1":
			_, _ = io.WriteString(w, `{"conversation_id":"conv-1","generations":[{"agent_name":"assistant","input":[{"parts":[{"text":"user msg"}]}],"output":[{"parts":[{"text":"assistant reply"}]}]}],"annotations":[]}`)
		case "/api/v1/agents:analyze-prompt-with-excerpts":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"status":"pending","strengths":[],"weaknesses":[]}`)
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
		case "/api/v1/agents:rating":
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"score":7,"summary":"Good baseline.","suggestions":[{"category":"tools","severity":"medium","title":"Clarify tools","description":"Tighten tool descriptions."}],"judge_model":"openai/gpt-4o-mini","judge_latency_ms":42}`)
		case "/api/v1/agents:rate":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"score":7,"summary":"Good baseline.","suggestions":[{"category":"tools","severity":"medium","title":"Clarify tools","description":"Tighten tool descriptions."}],"judge_model":"openai/gpt-4o-mini","judge_latency_ms":42}`)
		case "/api/v1/agents:prompt-insights":
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"status":"completed","strengths":[],"weaknesses":[],"judge_model":"openai/gpt-4o-mini","judge_latency_ms":100}`)
		case "/api/v1/agents:analyze-prompt":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"status":"completed","strengths":[],"weaknesses":[],"judge_model":"openai/gpt-4o-mini","judge_latency_ms":100}`)
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
			name:      "get conversation by id v2",
			method:    http.MethodGet,
			path:      "query/v2/conversations/c-1",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"conversation_id":"c-1","messages":[],"shared":{}}`),
		},
		{
			name:      "search conversations",
			method:    http.MethodPost,
			path:      "query/conversations/search",
			expStatus: http.StatusOK,
			reqBody:   []byte(`{"filters":"model=\"gpt-4o\"","select":["span.sigil.sdk.name"],"time_range":{"from":"2026-02-14T00:00:00Z","to":"2026-02-16T00:00:00Z"},"page_size":20}`),
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
			name:      "lookup agent rating",
			method:    http.MethodGet,
			path:      "query/agents/rating?name=assistant",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"score":7,"summary":"Good baseline.","suggestions":[{"category":"tools","severity":"medium","title":"Clarify tools","description":"Tighten tool descriptions."}],"judge_model":"openai/gpt-4o-mini","judge_latency_ms":42}`),
		},
		{
			name:      "rate agent",
			method:    http.MethodPost,
			path:      "query/agents/rate",
			reqBody:   []byte(`{"agent_name":"assistant","version":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`),
			expStatus: http.StatusOK,
			expBody:   []byte(`{"score":7,"summary":"Good baseline.","suggestions":[{"category":"tools","severity":"medium","title":"Clarify tools","description":"Tighten tool descriptions."}],"judge_model":"openai/gpt-4o-mini","judge_latency_ms":42}`),
		},
		{
			name:      "lookup prompt insights",
			method:    http.MethodGet,
			path:      "query/agents/prompt-insights?name=assistant",
			expStatus: http.StatusOK,
			expBody:   []byte(`{"status":"completed","strengths":[],"weaknesses":[],"judge_model":"openai/gpt-4o-mini","judge_latency_ms":100}`),
		},
		{
			name:      "analyze prompt",
			method:    http.MethodPost,
			path:      "query/agents/analyze-prompt",
			reqBody:   []byte(`{"agent_name":"assistant"}`),
			expStatus: http.StatusOK,
			expBody:   []byte(`{"status":"pending","strengths":[],"weaknesses":[]}`),
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

func TestCallResourceStreamsConversationSearchResults(t *testing.T) {
	searchRequests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/datasources/proxy/uid/tempo/api/search":
			searchRequests++
			switch searchRequests {
			case 1:
				_, _ = io.WriteString(w, buildTempoSearchResponse([]tempoSearchTraceFixture{
					{TraceID: "trace-1", StartTimeUnixNano: "1739609400000000000", ConversationID: "conv-1", GenerationID: "gen-1a", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-2", StartTimeUnixNano: "1739609399000000000", ConversationID: "conv-1", GenerationID: "gen-1b", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-3", StartTimeUnixNano: "1739609398000000000", ConversationID: "conv-1", GenerationID: "gen-1c", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-4", StartTimeUnixNano: "1739609397000000000", ConversationID: "conv-1", GenerationID: "gen-1d", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-5", StartTimeUnixNano: "1739609396000000000", ConversationID: "conv-1", GenerationID: "gen-1e", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-6", StartTimeUnixNano: "1739609395000000000", ConversationID: "conv-1", GenerationID: "gen-1f", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-7", StartTimeUnixNano: "1739609394000000000", ConversationID: "conv-1", GenerationID: "gen-1g", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-8", StartTimeUnixNano: "1739609393000000000", ConversationID: "conv-1", GenerationID: "gen-1h", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-9", StartTimeUnixNano: "1739609392000000000", ConversationID: "conv-1", GenerationID: "gen-1i", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-10", StartTimeUnixNano: "1739609391000000000", ConversationID: "conv-1", GenerationID: "gen-1j", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-11", StartTimeUnixNano: "1739609390000000000", ConversationID: "conv-1", GenerationID: "gen-1k", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
					{TraceID: "trace-12", StartTimeUnixNano: "1739609389000000000", ConversationID: "conv-1", GenerationID: "gen-1l", Model: "gpt-4o", Agent: "assistant", UserID: "user-1"},
				}))
			case 2:
				_, _ = io.WriteString(w, buildTempoSearchResponse([]tempoSearchTraceFixture{
					{TraceID: "trace-7", StartTimeUnixNano: "1739609300000000000", ConversationID: "conv-2", GenerationID: "gen-2", Model: "claude-sonnet-4-5", Agent: "assistant", UserID: "user-2"},
				}))
			default:
				_, _ = io.WriteString(w, `{"traces":[]}`)
			}
		case "/api/v1/conversations:batch-metadata":
			var payload struct {
				ConversationIDs []string `json:"conversation_ids"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			switch strings.Join(payload.ConversationIDs, ",") {
			case "conv-1":
				_, _ = io.WriteString(w, `{"items":[{"conversation_id":"conv-1","conversation_title":"Incident: first streamed title","generation_count":6,"first_generation_at":"2025-02-15T08:00:00Z","last_generation_at":"2025-02-15T09:30:00Z","annotation_count":0}],"missing_conversation_ids":[]}`)
			case "conv-2":
				_, _ = io.WriteString(w, `{"items":[{"conversation_id":"conv-2","conversation_title":"Incident: second streamed title","generation_count":1,"first_generation_at":"2025-02-15T07:50:00Z","last_generation_at":"2025-02-15T08:10:00Z","annotation_count":0}],"missing_conversation_ids":[]}`)
			default:
				http.Error(w, "unexpected conversation ids", http.StatusBadRequest)
			}
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

	responses := callResourceStreamWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/conversations/search/stream",
		Body:   []byte(`{"filters":"","select":[],"time_range":{"from":"2025-02-15T07:00:00Z","to":"2025-02-15T10:00:00Z"},"page_size":2}`),
	})
	if len(responses) != 3 {
		t.Fatalf("expected 3 streamed responses, got %d", len(responses))
	}
	if responses[0].Status != http.StatusOK {
		t.Fatalf("expected first chunk status %d, got %d", http.StatusOK, responses[0].Status)
	}
	if got := responses[0].Headers["Content-Type"]; len(got) == 0 || got[0] != "application/x-ndjson" {
		t.Fatalf("expected application/x-ndjson content type, got %v", got)
	}

	var first conversationSearchStreamResultsEvent
	if err := json.Unmarshal(bytes.TrimSpace(responses[0].Body), &first); err != nil {
		t.Fatalf("decode first stream chunk: %v", err)
	}
	if first.Type != "results" || len(first.Conversations) != 1 || first.Conversations[0].ConversationID != "conv-1" {
		t.Fatalf("unexpected first stream chunk: %+v", first)
	}
	if first.Conversations[0].ConversationTitle != "Incident: first streamed title" {
		t.Fatalf("expected title on first stream chunk, got %+v", first.Conversations[0])
	}

	var second conversationSearchStreamResultsEvent
	if err := json.Unmarshal(bytes.TrimSpace(responses[1].Body), &second); err != nil {
		t.Fatalf("decode second stream chunk: %v", err)
	}
	if second.Type != "results" || len(second.Conversations) != 1 || second.Conversations[0].ConversationID != "conv-2" {
		t.Fatalf("unexpected second stream chunk: %+v", second)
	}
	if second.Conversations[0].ConversationTitle != "Incident: second streamed title" {
		t.Fatalf("expected title on second stream chunk, got %+v", second.Conversations[0])
	}

	var complete conversationSearchStreamCompleteEvent
	if err := json.Unmarshal(bytes.TrimSpace(responses[2].Body), &complete); err != nil {
		t.Fatalf("decode completion stream chunk: %v", err)
	}
	if complete.Type != "complete" || complete.HasMore {
		t.Fatalf("unexpected completion chunk: %+v", complete)
	}
}

func TestCallResourceStreamsConversationSearchResultsViaBackendStreamProxy(t *testing.T) {
	streamRequests := 0
	tempoRequests := 0
	projectionListRequests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/conversations/search/stream":
			streamRequests++
			w.Header().Set("Content-Type", "application/x-ndjson")
			_, _ = io.WriteString(w, `{"type":"results","conversations":[{"conversation_id":"conv-2","conversation_title":"Escalation two","user_id":"user-2","generation_count":3,"first_generation_at":"2025-02-15T09:00:00Z","last_generation_at":"2025-02-15T09:30:00Z","models":["claude-3.7-sonnet"],"model_providers":{"claude-3.7-sonnet":"anthropic"},"agents":["router"],"trace_ids":[],"error_count":2,"has_errors":true,"annotation_count":2,"rating_summary":{"total_count":1,"good_count":0,"bad_count":1,"has_bad_rating":true}}]}`+"\n")
			_, _ = io.WriteString(w, `{"type":"complete","has_more":false}`+"\n")
		case "/api/datasources/proxy/uid/tempo/api/search":
			tempoRequests++
			http.Error(w, "tempo should not be called", http.StatusInternalServerError)
		case "/api/v1/conversations":
			projectionListRequests++
			http.Error(w, "projection fallback should not be called", http.StatusInternalServerError)
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

	responses := callResourceStreamWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/conversations/search/stream",
		Body:   []byte(`{"filters":"generation_count >= 1","select":[],"time_range":{"from":"2025-02-15T07:00:00Z","to":"2025-02-15T10:00:00Z"},"page_size":2}`),
	})
	if len(responses) != 1 {
		t.Fatalf("expected one proxied stream response, got %d", len(responses))
	}
	if streamRequests != 1 {
		t.Fatalf("expected one backend stream request, got %d", streamRequests)
	}
	if tempoRequests != 0 {
		t.Fatalf("expected backend stream proxy to avoid tempo, got %d tempo requests", tempoRequests)
	}
	if projectionListRequests != 0 {
		t.Fatalf("expected backend stream proxy to avoid projection fallback, got %d projection list requests", projectionListRequests)
	}

	lines := bytes.Split(bytes.TrimSpace(responses[0].Body), []byte("\n"))
	if len(lines) != 2 {
		t.Fatalf("expected 2 ndjson stream lines, got %d body=%s", len(lines), string(responses[0].Body))
	}

	var first conversationSearchStreamResultsEvent
	if err := json.Unmarshal(bytes.TrimSpace(lines[0]), &first); err != nil {
		t.Fatalf("decode first stream chunk: %v", err)
	}
	if first.Type != "results" || len(first.Conversations) != 1 {
		t.Fatalf("unexpected first stream chunk: %+v", first)
	}
	if first.Conversations[0].ConversationID != "conv-2" {
		t.Fatalf("expected proxied conversation result, got %+v", first.Conversations)
	}
	if first.Conversations[0].ConversationTitle != "Escalation two" || first.Conversations[0].AnnotationCount != 2 {
		t.Fatalf("expected proxied fields to be preserved, got %+v", first.Conversations[0])
	}

	var complete conversationSearchStreamCompleteEvent
	if err := json.Unmarshal(bytes.TrimSpace(lines[1]), &complete); err != nil {
		t.Fatalf("decode completion stream chunk: %v", err)
	}
	if complete.Type != "complete" || complete.HasMore {
		t.Fatalf("unexpected completion chunk: %+v", complete)
	}
}

func TestCallResourceStreamsConversationSearchFallbackUsesTempoWhenBackendStreamUnsupported(t *testing.T) {
	projectionListRequests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/conversations/search/stream":
			http.Error(w, "not implemented", http.StatusNotImplemented)
		case "/api/datasources/proxy/uid/tempo/api/search":
			_, _ = io.WriteString(w, buildTempoSearchResponse([]tempoSearchTraceFixture{
				{TraceID: "trace-1", StartTimeUnixNano: "1739610600000000000", ConversationID: "conv-1", GenerationID: "gen-1a", Model: "gpt-5", Agent: "assistant"},
			}))
		case "/api/v1/conversations":
			projectionListRequests++
			http.Error(w, "projection fallback should not be called", http.StatusInternalServerError)
		case "/api/v1/conversations:batch-metadata":
			_, _ = io.WriteString(w, `{"items":[
				{"conversation_id":"conv-1","conversation_title":"OpenAI route","generation_count":1,"first_generation_at":"2025-02-15T08:00:00Z","last_generation_at":"2025-02-15T08:10:00Z","models":["gpt-5"],"model_providers":{"gpt-5":"openai"},"agents":["assistant"],"error_count":0,"has_errors":false,"annotation_count":0}
			],"missing_conversation_ids":[]}`)
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

	responses := callResourceStreamWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/conversations/search/stream",
		Body:   []byte(`{"filters":"provider = \"openai\"","select":[],"time_range":{"from":"2025-02-15T07:00:00Z","to":"2025-02-15T10:00:00Z"},"page_size":10}`),
	})
	if len(responses) == 0 {
		t.Fatal("expected streamed fallback responses")
	}
	if projectionListRequests != 0 {
		t.Fatalf("expected fallback to avoid local projection list calls, got %d", projectionListRequests)
	}

	combinedBody := make([]byte, 0)
	for _, response := range responses {
		combinedBody = append(combinedBody, response.Body...)
	}

	lines := bytes.Split(bytes.TrimSpace(combinedBody), []byte("\n"))
	if len(lines) != 2 {
		t.Fatalf("expected 2 ndjson stream lines, got %d body=%s", len(lines), string(combinedBody))
	}

	var first conversationSearchStreamResultsEvent
	if err := json.Unmarshal(bytes.TrimSpace(lines[0]), &first); err != nil {
		t.Fatalf("decode first stream chunk: %v", err)
	}
	if len(first.Conversations) != 1 || first.Conversations[0].ConversationID != "conv-1" {
		t.Fatalf("expected provider filter to keep only conv-1, got %+v", first.Conversations)
	}
}

func TestCallResourceStreamsConversationSearchBypassesBackendProxyForRawTempoFilters(t *testing.T) {
	streamRequests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/conversations/search/stream":
			streamRequests++
			http.Error(w, `unknown filter key "resource.k8s.namespace.name"`, http.StatusBadRequest)
		case "/api/datasources/proxy/uid/tempo/api/search":
			_, _ = io.WriteString(w, buildTempoSearchResponse([]tempoSearchTraceFixture{
				{
					TraceID:           "trace-1",
					StartTimeUnixNano: "1739610600000000000",
					ConversationID:    "conv-1",
					GenerationID:      "gen-1a",
				},
			}))
		case "/api/v1/conversations:batch-metadata":
			_, _ = io.WriteString(w, `{"items":[
				{"conversation_id":"conv-1","conversation_title":"Namespace route","generation_count":1,"first_generation_at":"2025-02-15T08:00:00Z","last_generation_at":"2025-02-15T08:10:00Z","annotation_count":0}
			],"missing_conversation_ids":[]}`)
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

	responses := callResourceStreamWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/conversations/search/stream",
		Body:   []byte(`{"filters":"resource.k8s.namespace.name = \"assistant\"","select":[],"time_range":{"from":"2025-02-15T07:00:00Z","to":"2025-02-15T10:00:00Z"},"page_size":10}`),
	})
	if len(responses) == 0 {
		t.Fatal("expected streamed responses")
	}
	if streamRequests != 0 {
		t.Fatalf("expected raw tempo filters to bypass backend stream proxy, got %d backend requests", streamRequests)
	}

	combinedBody := make([]byte, 0)
	for _, response := range responses {
		combinedBody = append(combinedBody, response.Body...)
	}

	lines := bytes.Split(bytes.TrimSpace(combinedBody), []byte("\n"))
	if len(lines) != 2 {
		t.Fatalf("expected 2 ndjson stream lines, got %d body=%s", len(lines), string(combinedBody))
	}

	var first conversationSearchStreamResultsEvent
	if err := json.Unmarshal(bytes.TrimSpace(lines[0]), &first); err != nil {
		t.Fatalf("decode first stream chunk: %v", err)
	}
	if len(first.Conversations) != 1 || first.Conversations[0].ConversationID != "conv-1" {
		t.Fatalf("expected local fallback result for raw tempo filter, got %+v", first.Conversations)
	}
}

func TestCallResourceStreamsConversationSearchResultsAcrossMetadataChunks(t *testing.T) {
	fixtures := make([]tempoSearchTraceFixture, 0, conversationSearchMetadataChunkSize+1)
	for i := 0; i < conversationSearchMetadataChunkSize+1; i++ {
		suffix := strconv.Itoa(i + 1)
		fixtures = append(fixtures, tempoSearchTraceFixture{
			TraceID:           "trace-" + suffix,
			StartTimeUnixNano: strconv.FormatInt(1739609400000000000-int64(i), 10),
			ConversationID:    "conv-" + suffix,
			GenerationID:      "gen-" + suffix,
			Model:             "gpt-4o",
			Agent:             "assistant",
			UserID:            "user-" + suffix,
		})
	}

	metadataRequests := make([][]string, 0, 2)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/datasources/proxy/uid/tempo/api/search":
			_, _ = io.WriteString(w, buildTempoSearchResponse(fixtures))
		case "/api/v1/conversations:batch-metadata":
			var payload struct {
				ConversationIDs []string `json:"conversation_ids"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			metadataRequests = append(metadataRequests, append([]string(nil), payload.ConversationIDs...))
			items := make([]string, 0, len(payload.ConversationIDs))
			for _, id := range payload.ConversationIDs {
				items = append(items, `{"conversation_id":"`+id+`","generation_count":1,"first_generation_at":"2025-02-15T08:00:00Z","last_generation_at":"2025-02-15T09:30:00Z","annotation_count":0}`)
			}
			_, _ = io.WriteString(w, `{"items":[`+strings.Join(items, ",")+`],"missing_conversation_ids":[]}`)
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

	responses := callResourceStreamWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/conversations/search/stream",
		Body:   []byte(`{"filters":"","select":[],"time_range":{"from":"2025-02-15T07:00:00Z","to":"2025-02-15T10:00:00Z"},"page_size":` + strconv.Itoa(conversationSearchMetadataChunkSize+1) + `}`),
	})
	if len(responses) != 2 {
		t.Fatalf("expected 2 streamed responses, got %d", len(responses))
	}
	if len(metadataRequests) == 0 {
		t.Fatal("expected at least 1 metadata request")
	}
	expectedFirstChunkSize := min(conversationSearchMetadataChunkSize, len(fixtures))
	if len(metadataRequests[0]) != expectedFirstChunkSize {
		t.Fatalf("expected first metadata chunk size %d, got %d", expectedFirstChunkSize, len(metadataRequests[0]))
	}
	if len(metadataRequests) > 1 && len(metadataRequests[1]) != 1 {
		t.Fatalf("expected second metadata chunk size 1, got %d", len(metadataRequests[1]))
	}

	var first conversationSearchStreamResultsEvent
	if err := json.Unmarshal(bytes.TrimSpace(responses[0].Body), &first); err != nil {
		t.Fatalf("decode first stream chunk: %v", err)
	}
	expectedFirstResults := min(searchcore.MaxConversationSearchPageSize, conversationSearchMetadataChunkSize)
	if first.Type != "results" || len(first.Conversations) != expectedFirstResults {
		t.Fatalf("unexpected first stream chunk: %+v", first)
	}

	var complete conversationSearchStreamCompleteEvent
	if err := json.Unmarshal(bytes.TrimSpace(responses[1].Body), &complete); err != nil {
		t.Fatalf("decode completion stream chunk: %v", err)
	}
	if complete.Type != "complete" || !complete.HasMore {
		t.Fatalf("unexpected completion chunk: %+v", complete)
	}
}

func TestCallResourceStreamsConversationSearchErrorsAfterPartialResults(t *testing.T) {
	searchRequests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/datasources/proxy/uid/tempo/api/search":
			searchRequests++
			if searchRequests == 1 {
				_, _ = io.WriteString(w, buildTempoSearchResponse([]tempoSearchTraceFixture{
					{TraceID: "trace-1", StartTimeUnixNano: "1739609400000000000", ConversationID: "conv-1", GenerationID: "gen-1a"},
					{TraceID: "trace-2", StartTimeUnixNano: "1739609399000000000", ConversationID: "conv-1", GenerationID: "gen-1b"},
					{TraceID: "trace-3", StartTimeUnixNano: "1739609398000000000", ConversationID: "conv-1", GenerationID: "gen-1c"},
					{TraceID: "trace-4", StartTimeUnixNano: "1739609397000000000", ConversationID: "conv-1", GenerationID: "gen-1d"},
					{TraceID: "trace-5", StartTimeUnixNano: "1739609396000000000", ConversationID: "conv-1", GenerationID: "gen-1e"},
					{TraceID: "trace-6", StartTimeUnixNano: "1739609395000000000", ConversationID: "conv-1", GenerationID: "gen-1f"},
					{TraceID: "trace-7", StartTimeUnixNano: "1739609394000000000", ConversationID: "conv-1", GenerationID: "gen-1g"},
					{TraceID: "trace-8", StartTimeUnixNano: "1739609393000000000", ConversationID: "conv-1", GenerationID: "gen-1h"},
					{TraceID: "trace-9", StartTimeUnixNano: "1739609392000000000", ConversationID: "conv-1", GenerationID: "gen-1i"},
					{TraceID: "trace-10", StartTimeUnixNano: "1739609391000000000", ConversationID: "conv-1", GenerationID: "gen-1j"},
					{TraceID: "trace-11", StartTimeUnixNano: "1739609390000000000", ConversationID: "conv-1", GenerationID: "gen-1k"},
					{TraceID: "trace-12", StartTimeUnixNano: "1739609389000000000", ConversationID: "conv-1", GenerationID: "gen-1l"},
				}))
				return
			}
			http.Error(w, "tempo failed", http.StatusBadGateway)
		case "/api/v1/conversations:batch-metadata":
			_, _ = io.WriteString(w, `{"items":[{"conversation_id":"conv-1","generation_count":6,"first_generation_at":"2025-02-15T08:00:00Z","last_generation_at":"2025-02-15T09:30:00Z","annotation_count":0}],"missing_conversation_ids":[]}`)
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

	responses := callResourceStreamWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/conversations/search/stream",
		Body:   []byte(`{"filters":"","select":[],"time_range":{"from":"2025-02-15T07:00:00Z","to":"2025-02-15T10:00:00Z"},"page_size":2}`),
	})
	if len(responses) != 2 {
		t.Fatalf("expected 2 streamed responses, got %d", len(responses))
	}

	var first conversationSearchStreamResultsEvent
	if err := json.Unmarshal(bytes.TrimSpace(responses[0].Body), &first); err != nil {
		t.Fatalf("decode first stream chunk: %v", err)
	}
	if first.Type != "results" || len(first.Conversations) != 1 {
		t.Fatalf("unexpected first chunk: %+v", first)
	}

	var second conversationSearchStreamErrorEvent
	if err := json.Unmarshal(bytes.TrimSpace(responses[1].Body), &second); err != nil {
		t.Fatalf("decode error chunk: %v", err)
	}
	if second.Type != "error" || !strings.Contains(second.Message, "tempo failed") {
		t.Fatalf("unexpected error chunk: %+v", second)
	}
}

func TestCallResourceConversationStatsAggregatesSearchResults(t *testing.T) {
	searchRequests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/datasources/proxy/uid/tempo/api/search":
			searchRequests++
			switch searchRequests {
			case 1:
				_, _ = io.WriteString(w, buildTempoSearchResponse([]tempoSearchTraceFixture{
					{TraceID: "trace-1", StartTimeUnixNano: "1739609400000000000", ConversationID: "conv-1", GenerationID: "gen-1a"},
					{TraceID: "trace-2", StartTimeUnixNano: "1739609399000000000", ConversationID: "conv-1", GenerationID: "gen-1b"},
					{TraceID: "trace-3", StartTimeUnixNano: "1739609300000000000", ConversationID: "conv-2", GenerationID: "gen-2a"},
				}))
			default:
				_, _ = io.WriteString(w, `{"traces":[]}`)
			}
		case "/api/v1/conversations:batch-metadata":
			var payload struct {
				ConversationIDs []string `json:"conversation_ids"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			switch strings.Join(payload.ConversationIDs, ",") {
			case "conv-1,conv-2":
				_, _ = io.WriteString(w, `{"items":[
					{"conversation_id":"conv-1","generation_count":2,"first_generation_at":"2025-02-15T08:00:00Z","last_generation_at":"2025-02-15T09:30:00Z","annotation_count":0,"rating_summary":{"total_count":1,"good_count":0,"bad_count":1,"has_bad_rating":true}},
					{"conversation_id":"conv-2","generation_count":1,"first_generation_at":"2025-02-15T07:50:00Z","last_generation_at":"2025-02-15T08:10:00Z","annotation_count":0,"rating_summary":{"total_count":1,"good_count":1,"bad_count":0,"has_bad_rating":false}}
				],"missing_conversation_ids":[]}`)
			default:
				http.Error(w, "unexpected conversation ids", http.StatusBadRequest)
			}
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

	response := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/conversations/stats",
		Body: []byte(`{
			"filters":"",
			"time_range":{"from":"2025-02-15T07:00:00Z","to":"2025-02-15T10:00:00Z"}
		}`),
	})
	if response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.Status)
	}

	var stats conversationStatsResponse
	if err := json.Unmarshal(bytes.TrimSpace(response.Body), &stats); err != nil {
		t.Fatalf("decode stats response: %v", err)
	}
	if stats.TotalConversations != 2 {
		t.Fatalf("expected 2 conversations, got %d", stats.TotalConversations)
	}
	if stats.TotalTokens != 0 {
		t.Fatalf("expected 0 tokens without selected fields in fixture, got %f", stats.TotalTokens)
	}
	if stats.AvgCallsPerConversation != 1.5 {
		t.Fatalf("expected avg calls 1.5, got %f", stats.AvgCallsPerConversation)
	}
	if stats.ActiveLast7d != 2 {
		t.Fatalf("expected 2 active conversations, got %d", stats.ActiveLast7d)
	}
	if stats.RatedConversations != 2 {
		t.Fatalf("expected 2 rated conversations, got %d", stats.RatedConversations)
	}
	if stats.BadRatedPct != 50 {
		t.Fatalf("expected bad rated pct 50, got %f", stats.BadRatedPct)
	}
}

func TestCallResourceConversationStatsFallsBackToTempoSearchWhenBackendStatsUnsupported(t *testing.T) {
	tempoRequests := 0
	projectionListRequests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/conversations/stats":
			http.Error(w, "not implemented", http.StatusNotImplemented)
		case "/api/v1/conversations/search":
			http.Error(w, "not implemented", http.StatusNotImplemented)
		case "/api/datasources/proxy/uid/tempo/api/search":
			tempoRequests++
			switch tempoRequests {
			case 1:
				_, _ = io.WriteString(w, buildTempoSearchResponse([]tempoSearchTraceFixture{
					{TraceID: "trace-1", StartTimeUnixNano: "1739609400000000000", ConversationID: "conv-1", GenerationID: "gen-1a"},
					{TraceID: "trace-2", StartTimeUnixNano: "1739609399000000000", ConversationID: "conv-1", GenerationID: "gen-1b"},
					{TraceID: "trace-3", StartTimeUnixNano: "1739609300000000000", ConversationID: "conv-2", GenerationID: "gen-2a"},
				}))
			default:
				_, _ = io.WriteString(w, `{"traces":[]}`)
			}
		case "/api/v1/conversations":
			projectionListRequests++
			http.Error(w, "projection fallback should not be called", http.StatusInternalServerError)
		case "/api/v1/conversations:batch-metadata":
			var payload struct {
				ConversationIDs []string `json:"conversation_ids"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			switch strings.Join(payload.ConversationIDs, ",") {
			case "conv-1,conv-2":
				_, _ = io.WriteString(w, `{"items":[
					{"conversation_id":"conv-1","conversation_title":"Escalation one","generation_count":2,"first_generation_at":"2025-02-15T08:00:00Z","last_generation_at":"2025-02-15T09:30:00Z","annotation_count":0,"rating_summary":{"total_count":1,"good_count":0,"bad_count":1,"has_bad_rating":true}},
					{"conversation_id":"conv-2","conversation_title":"Escalation two","generation_count":1,"first_generation_at":"2025-02-15T07:50:00Z","last_generation_at":"2025-02-15T08:10:00Z","annotation_count":0}
				],"missing_conversation_ids":[]}`)
			default:
				http.Error(w, "unexpected conversation ids", http.StatusBadRequest)
			}
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

	response := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/conversations/stats",
		Body: []byte(`{
			"filters":"generation_count >= 1",
			"time_range":{"from":"2025-02-15T07:00:00Z","to":"2025-02-15T10:00:00Z"}
		}`),
	})
	if response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.Status)
	}
	if tempoRequests == 0 {
		t.Fatalf("expected Tempo fallback when backend stats/search endpoints are unsupported")
	}
	if projectionListRequests != 0 {
		t.Fatalf("expected fallback to avoid local projection list calls, got %d", projectionListRequests)
	}

	var stats conversationStatsResponse
	if err := json.Unmarshal(bytes.TrimSpace(response.Body), &stats); err != nil {
		t.Fatalf("decode stats response: %v", err)
	}
	if stats.TotalConversations != 2 {
		t.Fatalf("expected 2 conversations, got %d", stats.TotalConversations)
	}
	if stats.TotalTokens != 0 {
		t.Fatalf("expected 0 tokens without selected values in fixture, got %f", stats.TotalTokens)
	}
	if stats.AvgCallsPerConversation != 1.5 {
		t.Fatalf("expected avg calls 1.5, got %f", stats.AvgCallsPerConversation)
	}
	if stats.ActiveLast7d != 2 {
		t.Fatalf("expected 2 active conversations, got %d", stats.ActiveLast7d)
	}
	if stats.RatedConversations != 1 {
		t.Fatalf("expected 1 rated conversation, got %d", stats.RatedConversations)
	}
	if stats.BadRatedPct != 100 {
		t.Fatalf("expected bad rated pct 100, got %f", stats.BadRatedPct)
	}
}

func TestCallResourceConversationStatsBypassesBackendProxyForRawTempoFilters(t *testing.T) {
	statsRequests := 0
	tempoRequests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/conversations/stats":
			statsRequests++
			http.Error(w, `unknown filter key "resource.k8s.namespace.name"`, http.StatusBadRequest)
		case "/api/datasources/proxy/uid/tempo/api/search":
			tempoRequests++
			switch tempoRequests {
			case 1:
				_, _ = io.WriteString(w, buildTempoSearchResponse([]tempoSearchTraceFixture{
					{
						TraceID:           "trace-1",
						StartTimeUnixNano: "1739609400000000000",
						ConversationID:    "conv-1",
						GenerationID:      "gen-1a",
					},
				}))
			default:
				_, _ = io.WriteString(w, `{"traces":[]}`)
			}
		case "/api/v1/conversations:batch-metadata":
			_, _ = io.WriteString(w, `{"items":[
				{"conversation_id":"conv-1","conversation_title":"Namespace route","generation_count":1,"first_generation_at":"2025-02-15T08:00:00Z","last_generation_at":"2025-02-15T08:10:00Z","annotation_count":0}
			],"missing_conversation_ids":[]}`)
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

	response := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/conversations/stats",
		Body: []byte(`{
			"filters":"resource.k8s.namespace.name = \"assistant\"",
			"time_range":{"from":"2025-02-15T07:00:00Z","to":"2025-02-15T10:00:00Z"}
		}`),
	})
	if response.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, response.Status, response.Body)
	}
	if statsRequests != 0 {
		t.Fatalf("expected raw tempo filters to bypass backend stats proxy, got %d backend requests", statsRequests)
	}
	if tempoRequests == 0 {
		t.Fatal("expected local tempo search to run for raw tempo filters")
	}

	var stats conversationStatsResponse
	if err := json.Unmarshal(bytes.TrimSpace(response.Body), &stats); err != nil {
		t.Fatalf("decode stats response: %v", err)
	}
	if stats.TotalConversations != 1 {
		t.Fatalf("expected 1 conversation, got %d", stats.TotalConversations)
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

func TestCallResourceSearchTagsForwardsScopedTraceQLQuery(t *testing.T) {
	const scopedQuery = `{ span.gen_ai.conversation.id != "" }`

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/datasources/proxy/uid/tempo/api/v2/search/tags" {
			http.NotFound(w, r)
			return
		}
		if got := r.URL.Query().Get("q"); got != scopedQuery {
			http.Error(w, "missing scoped search query", http.StatusBadRequest)
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
		Path:   "query/search/tags?q=%7B+span.gen_ai.conversation.id+%21%3D+%22%22+%7D",
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
	}
}

func TestCallResourceSearchTagValuesForwardsScopedTraceQLQuery(t *testing.T) {
	const scopedQuery = `{ span.gen_ai.conversation.id != "" }`

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/datasources/proxy/uid/tempo/api/v2/search/tag/resource.k8s.namespace.name/values" {
			http.NotFound(w, r)
			return
		}
		if got := r.URL.Query().Get("q"); got != scopedQuery {
			http.Error(w, "missing scoped search query", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"values":["prod"]}`)
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
		Path:   "query/search/tag/resource.k8s.namespace.name/values?q=%7B+span.gen_ai.conversation.id+%21%3D+%22%22+%7D",
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
	seenGrafanaUsers := map[string]string{}
	seenTrustedActors := map[string]string{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost || r.Method == http.MethodPatch {
			seenGrafanaUsers[r.URL.Path] = r.Header.Get(headerGrafanaUser)
			seenTrustedActors[r.URL.Path] = r.Header.Get(headerSigilTrustedActor)
		}
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
		case "/api/v1/eval:test":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			_, _ = io.WriteString(w, `{"status":"ok"}`)
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
		{
			name:      "test eval",
			method:    http.MethodPost,
			path:      "eval:test",
			body:      []byte(`{"kind":"llm_judge","config":{}}`),
			expStatus: http.StatusOK,
			expBody:   []byte(`{"status":"ok"}`),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resp := callResourceWithAuth(t, app, &backend.CallResourceRequest{
				Method: tc.method,
				Path:   tc.path,
				Body:   tc.body,
				Headers: map[string][]string{
					headerGrafanaUser:       {"spoofed@example.com"},
					headerSigilTrustedActor: {"false"},
				},
				PluginContext: backend.PluginContext{
					User: &backend.User{
						Login: "admin",
						Email: "admin@localhost",
					},
				},
			})
			if resp.Status != tc.expStatus {
				t.Fatalf("expected status %d, got %d body=%s", tc.expStatus, resp.Status, resp.Body)
			}
			if len(tc.expBody) > 0 {
				if tb := bytes.TrimSpace(resp.Body); !bytes.Equal(tb, tc.expBody) {
					t.Fatalf("response body should be %s, got %s", tc.expBody, tb)
				}
			}
			wantUser := ""
			switch tc.path {
			case "eval/evaluators":
				wantUser = seenGrafanaUsers["/api/v1/eval/evaluators"]
			case "eval/predefined/evaluators/sigil.helpfulness:fork":
				wantUser = seenGrafanaUsers["/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork"]
			case "eval/rules":
				wantUser = seenGrafanaUsers["/api/v1/eval/rules"]
			case "eval/rules/rule-1":
				wantUser = seenGrafanaUsers["/api/v1/eval/rules/rule-1"]
			}
			if tc.path != "eval/rules:preview" && tc.path != "eval:test" && wantUser != "admin@localhost" {
				t.Fatalf("expected X-Grafana-User to be forwarded for %s, got %q", tc.path, wantUser)
			}
			switch tc.path {
			case "eval/evaluators":
				if seenTrustedActors["/api/v1/eval/evaluators"] != "true" {
					t.Fatalf("expected trusted actor header for %s, got %q", tc.path, seenTrustedActors["/api/v1/eval/evaluators"])
				}
			case "eval/predefined/evaluators/sigil.helpfulness:fork":
				if seenTrustedActors["/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork"] != "true" {
					t.Fatalf("expected trusted actor header for %s, got %q", tc.path, seenTrustedActors["/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork"])
				}
			case "eval/rules":
				if seenTrustedActors["/api/v1/eval/rules"] != "true" {
					t.Fatalf("expected trusted actor header for %s, got %q", tc.path, seenTrustedActors["/api/v1/eval/rules"])
				}
			case "eval/rules/rule-1":
				if seenTrustedActors["/api/v1/eval/rules/rule-1"] != "true" {
					t.Fatalf("expected trusted actor header for %s, got %q", tc.path, seenTrustedActors["/api/v1/eval/rules/rule-1"])
				}
			}
			if tc.path == "eval/rules:preview" && seenGrafanaUsers["/api/v1/eval/rules:preview"] != "" {
				t.Fatalf("expected no X-Grafana-User header for eval preview, got %q", seenGrafanaUsers["/api/v1/eval/rules:preview"])
			}
			if tc.path == "eval/rules:preview" && seenTrustedActors["/api/v1/eval/rules:preview"] != "" {
				t.Fatalf("expected no trusted actor header for eval preview, got %q", seenTrustedActors["/api/v1/eval/rules:preview"])
			}
			if tc.path == "eval:test" && seenGrafanaUsers["/api/v1/eval:test"] != "" {
				t.Fatalf("expected no X-Grafana-User header for eval test, got %q", seenGrafanaUsers["/api/v1/eval:test"])
			}
			if tc.path == "eval:test" && seenTrustedActors["/api/v1/eval:test"] != "" {
				t.Fatalf("expected no trusted actor header for eval test, got %q", seenTrustedActors["/api/v1/eval:test"])
			}
		})
	}
}

func TestCallResourceForwardsGzipEncodedResponses(t *testing.T) {
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

	contentEncoding := sender.Headers["Content-Encoding"]
	if len(contentEncoding) == 0 || contentEncoding[0] != "gzip" {
		t.Fatalf("expected gzip content encoding, got headers=%v", sender.Headers)
	}

	gz, err := gzip.NewReader(bytes.NewReader(sender.Body))
	if err != nil {
		t.Fatalf("response body is not gzip-compressed: %v", err)
	}
	decompressed, err := io.ReadAll(gz)
	if err != nil {
		t.Fatalf("failed to decompress response body: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("failed to close gzip reader: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(decompressed, &result); err != nil {
		t.Fatalf("decompressed response body is not valid JSON: %v\nbody bytes: %x", err, decompressed)
	}
}

func TestCallResourceForwardsGzipEncodedGrafanaProxyResponses(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/datasources/proxy/uid/tempo-ds/api/search" {
			http.Error(w, "unexpected path", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			w.Header().Set("Content-Encoding", "gzip")
			gz := gzip.NewWriter(w)
			_, _ = gz.Write([]byte(`{"traces":[]}`))
			_ = gz.Close()
			return
		}
		_, _ = io.WriteString(w, `{"traces":[]}`)
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
	app.tempoDatasourceUID = "tempo-ds"

	sender := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodGet,
		Path:   "query/proxy/tempo/api/search",
		Headers: map[string][]string{
			"Accept-Encoding": {"gzip"},
		},
	})
	if sender.Status != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, sender.Status, sender.Body)
	}

	contentEncoding := sender.Headers["Content-Encoding"]
	if len(contentEncoding) == 0 || contentEncoding[0] != "gzip" {
		t.Fatalf("expected gzip content encoding, got headers=%v", sender.Headers)
	}

	gz, err := gzip.NewReader(bytes.NewReader(sender.Body))
	if err != nil {
		t.Fatalf("response body is not gzip-compressed: %v", err)
	}
	decompressed, err := io.ReadAll(gz)
	if err != nil {
		t.Fatalf("failed to decompress response body: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("failed to close gzip reader: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(decompressed, &result); err != nil {
		t.Fatalf("decompressed response body is not valid JSON: %v\nbody bytes: %x", err, decompressed)
	}
}

func TestCallResourceSearchErrorDecompressesGzippedUpstreamBody(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/conversations/stats" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		gz := gzip.NewWriter(w)
		_, _ = gz.Write([]byte("backend exploded"))
		_ = gz.Close()
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
		Method: http.MethodPost,
		Path:   "query/conversations/stats",
		Body: []byte(`{
			"filters":"provider = \"openai\"",
			"time_range":{"from":"2026-03-11T10:00:00Z","to":"2026-03-11T11:00:00Z"}
		}`),
	})
	if sender.Status != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusBadRequest, sender.Status, sender.Body)
	}
	if string(sender.Body) != "backend exploded\n" {
		t.Fatalf("expected decompressed error body, got %q", string(sender.Body))
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
		name    string
		input   string
		wantID  string
		wantTok string
		wantOK  bool
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

func TestAnalyzePromptFetchesExcerptsAndForwardsToSigil(t *testing.T) {
	var receivedUpstreamBody []byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/datasources/proxy/uid/tempo/api/search":
			_, _ = io.WriteString(w, buildTempoSearchResponse([]tempoSearchTraceFixture{
				{TraceID: "trace-1", StartTimeUnixNano: "1739609400000000000", ConversationID: "conv-1", GenerationID: "gen-1", Model: "gpt-4o", Agent: "test-agent", UserID: "user-1"},
				{TraceID: "trace-2", StartTimeUnixNano: "1739609300000000000", ConversationID: "conv-2", GenerationID: "gen-2", Model: "gpt-4o", Agent: "test-agent", UserID: "user-2"},
			}))
		case "/api/v1/conversations:batch-metadata":
			_, _ = io.WriteString(w, `{"items":[{"conversation_id":"conv-1","generation_count":2,"first_generation_at":"2025-02-15T08:00:00Z","last_generation_at":"2025-02-15T09:00:00Z","annotation_count":0},{"conversation_id":"conv-2","generation_count":1,"first_generation_at":"2025-02-15T07:00:00Z","last_generation_at":"2025-02-15T07:30:00Z","annotation_count":0}],"missing_conversation_ids":[]}`)
		case "/api/v1/conversations/conv-1":
			_, _ = io.WriteString(w, `{"conversation_id":"conv-1","generations":[{"agent_name":"test-agent","input":[{"parts":[{"text":"Hello agent"}]}],"output":[{"parts":[{"text":"Hi there!"}]}]},{"agent_name":"test-agent","input":[{"parts":[{"text":"Follow up"}]}],"output":[{"parts":[{"tool_call":{"name":"search"}}]}]}],"annotations":[]}`)
		case "/api/v1/conversations/conv-2":
			_, _ = io.WriteString(w, `{"conversation_id":"conv-2","generations":[{"agent_name":"test-agent","input":[{"parts":[{"text":"Question"}]}],"output":[{"parts":[{"text":"Answer"}]}]}],"annotations":[]}`)
		case "/api/v1/agents:analyze-prompt-with-excerpts":
			receivedUpstreamBody, _ = io.ReadAll(r.Body)
			_, _ = io.WriteString(w, `{"status":"pending","strengths":[],"weaknesses":[]}`)
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

	resp := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/agents/analyze-prompt",
		Body:   []byte(`{"agent_name":"test-agent","lookback":"7d"}`),
	})

	if resp.Status != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.Status, resp.Body)
	}

	if len(receivedUpstreamBody) == 0 {
		t.Fatal("expected upstream to receive analyze-prompt-with-excerpts request")
	}

	var upstreamPayload analyzePromptWithExcerptsUpstream
	if err := json.Unmarshal(receivedUpstreamBody, &upstreamPayload); err != nil {
		t.Fatalf("decode upstream body: %v", err)
	}
	if upstreamPayload.AgentName != "test-agent" {
		t.Fatalf("expected agent_name test-agent, got %q", upstreamPayload.AgentName)
	}
	if len(upstreamPayload.Excerpts) != 2 {
		t.Fatalf("expected 2 excerpts, got %d", len(upstreamPayload.Excerpts))
	}

	first := upstreamPayload.Excerpts[0]
	if first.ConversationID != "conv-1" {
		t.Fatalf("expected first excerpt conv-1, got %q", first.ConversationID)
	}
	if first.GenerationCount != 2 {
		t.Fatalf("expected 2 generations in first excerpt, got %d", first.GenerationCount)
	}
	if first.UserInput != "Hello agent" {
		t.Fatalf("expected user input 'Hello agent', got %q", first.UserInput)
	}
	if first.AssistantOutput != "Hi there!" {
		t.Fatalf("expected assistant output 'Hi there!', got %q", first.AssistantOutput)
	}
	if first.ToolCallCount != 1 {
		t.Fatalf("expected 1 tool call, got %d", first.ToolCallCount)
	}

	second := upstreamPayload.Excerpts[1]
	if second.ConversationID != "conv-2" {
		t.Fatalf("expected second excerpt conv-2, got %q", second.ConversationID)
	}
	if second.UserInput != "Question" {
		t.Fatalf("expected user input 'Question', got %q", second.UserInput)
	}
}

func TestAnalyzePromptFallsBackToProxyWithoutTempo(t *testing.T) {
	var receivedBody []byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/agents:analyze-prompt" {
			receivedBody, _ = io.ReadAll(r.Body)
			_, _ = io.WriteString(w, `{"status":"pending","strengths":[],"weaknesses":[]}`)
			return
		}
		http.NotFound(w, r)
	}))
	defer upstream.Close()

	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app := inst.(*App)
	app.authzClient = newMockAuthzClient(allowAllSigilActions())
	app.apiURL = upstream.URL

	resp := callResourceWithAuth(t, app, &backend.CallResourceRequest{
		Method: http.MethodPost,
		Path:   "query/agents/analyze-prompt",
		Body:   []byte(`{"agent_name":"test-agent"}`),
	})

	if resp.Status != http.StatusOK {
		t.Fatalf("expected 200 from proxy fallback, got %d body=%s", resp.Status, resp.Body)
	}
	if !strings.Contains(string(resp.Body), `"status":"pending"`) {
		t.Fatalf("expected pending status from proxy fallback, body=%s", resp.Body)
	}
	if len(receivedBody) == 0 {
		t.Fatal("expected upstream to receive request body, got empty body")
	}
	var forwarded analyzePromptPluginRequest
	if err := json.Unmarshal(receivedBody, &forwarded); err != nil {
		t.Fatalf("decode forwarded body: %v", err)
	}
	if forwarded.AgentName != "test-agent" {
		t.Fatalf("expected forwarded agent_name 'test-agent', got %q", forwarded.AgentName)
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

func TestDecodeConversationSearchRequestPreservesBody(t *testing.T) {
	payload := `{"timeRange":{"from":"2025-01-01T00:00:00Z","to":"2025-01-02T00:00:00Z"}}`
	req := httptest.NewRequest(http.MethodPost, "/query/conversations/search", strings.NewReader(payload))

	_, err := decodeConversationSearchRequest(req)
	if err != nil {
		t.Fatalf("unexpected decode error: %v", err)
	}

	remaining, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatalf("unexpected error reading body after decode: %v", err)
	}
	if string(remaining) != payload {
		t.Fatalf("body not preserved after decode: got %q, want %q", string(remaining), payload)
	}
}
