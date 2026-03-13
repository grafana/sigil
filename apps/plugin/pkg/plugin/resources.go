package plugin

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/sigil/sigil/pkg/searchcore"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

type stubResponse struct {
	Status   string `json:"status"`
	Source   string `json:"source"`
	Endpoint string `json:"endpoint"`
	Error    string `json:"error,omitempty"`
}

var pluginProxyTracer = otel.Tracer("github.com/grafana/sigil/apps/plugin/proxy")

const (
	headerGrafanaUser       = "X-Grafana-User"
	headerSigilTrustedActor = "X-Sigil-Trusted-Actor"
)

func (a *App) authorizeRequest(req *http.Request) error {
	action, ok := requiredPermissionAction(req.Method, req.URL.Path)
	if !ok {
		return nil
	}
	return a.checkPermission(req.Context(), req.Header.Get("X-Grafana-Id"), action)
}

func (a *App) checkPermission(ctx context.Context, idToken string, action string) error {
	trimmedToken := strings.TrimSpace(idToken)
	if trimmedToken == "" {
		return errors.New("authentication required: missing X-Grafana-Id header")
	}
	if strings.TrimSpace(action) == "" {
		return errors.New("permission action is empty")
	}

	authzClient, err := a.getAuthzClient(ctx)
	if err != nil {
		return fmt.Errorf("authorization unavailable: %w", err)
	}

	hasAccess, err := authzClient.HasAccess(ctx, trimmedToken, action)
	if err != nil {
		return fmt.Errorf("permission check failed: %w", err)
	}
	if !hasAccess {
		return fmt.Errorf("permission denied: %s required", action)
	}
	return nil
}

func denyPermission(w http.ResponseWriter, err error) {
	if err == nil {
		http.Error(w, "permission denied", http.StatusForbidden)
		return
	}
	http.Error(w, err.Error(), http.StatusForbidden)
}

func (a *App) withAuthorization(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if err := a.authorizeRequest(req); err != nil {
			denyPermission(w, err)
			return
		}
		next(w, req)
	}
}

// requiredPermissionAction maps a plugin query route to the RBAC action it
// requires. Unknown routes or method/path mismatches return ok=false.
func requiredPermissionAction(method string, path string) (string, bool) {
	switch {
	case method == http.MethodGet && path == "/query/conversations":
		return permissionDataRead, true
	case method == http.MethodPost && path == "/query/conversations/search":
		return permissionDataRead, true
	case method == http.MethodPost && path == "/query/conversations/search/stream":
		return permissionDataRead, true
	case method == http.MethodPost && path == "/query/conversations/stats":
		return permissionDataRead, true
	case method == http.MethodGet && strings.HasPrefix(path, "/query/v2/conversations/"):
		return permissionDataRead, true
	case strings.HasPrefix(path, "/query/conversations/"):
		return permissionForConversationRoute(method, path)
	case method == http.MethodGet && strings.HasPrefix(path, "/query/generations/"):
		return permissionDataRead, true
	case method == http.MethodGet && path == "/query/search/tags":
		return permissionDataRead, true
	case method == http.MethodGet && strings.HasPrefix(path, "/query/search/tag/") && strings.HasSuffix(path, "/values"):
		return permissionDataRead, true
	case method == http.MethodGet && path == "/query/settings":
		return permissionDataRead, true
	case method == http.MethodPut && path == "/query/settings/datasources":
		return permissionSettingsWrite, true
	case strings.HasPrefix(path, "/query/proxy/prometheus/"):
		return permissionDataRead, true
	case strings.HasPrefix(path, "/query/proxy/tempo/"):
		return permissionDataRead, true
	case method == http.MethodGet && path == "/query/model-cards":
		return permissionDataRead, true
	case method == http.MethodGet && path == "/query/model-cards/lookup":
		return permissionDataRead, true
	case method == http.MethodGet && path == "/query/agents":
		return permissionDataRead, true
	case method == http.MethodGet && path == "/query/agents/lookup":
		return permissionDataRead, true
	case method == http.MethodGet && path == "/query/agents/versions":
		return permissionDataRead, true
	case method == http.MethodGet && path == "/query/agents/rating":
		return permissionDataRead, true
	case method == http.MethodPost && path == "/query/agents/rate":
		return permissionEvalWrite, true
	case method == http.MethodGet && path == "/query/agents/prompt-insights":
		return permissionDataRead, true
	case method == http.MethodPost && path == "/query/agents/analyze-prompt":
		return permissionEvalWrite, true
	case strings.HasPrefix(path, "/eval/") || path == "/eval:test":
		return permissionForEvalRoute(method, path)
	default:
		return "", false
	}
}

func permissionForConversationRoute(method string, path string) (string, bool) {
	conversationPath := strings.TrimPrefix(path, "/query/conversations/")
	if conversationPath == "" {
		return "", false
	}

	parts := strings.Split(conversationPath, "/")
	if len(parts) == 1 && method == http.MethodGet {
		return permissionDataRead, true
	}
	if len(parts) != 2 {
		return "", false
	}

	switch parts[1] {
	case "ratings", "annotations":
		if method == http.MethodGet {
			return permissionDataRead, true
		}
		if method == http.MethodPost {
			return permissionFeedbackWrite, true
		}
	case "followup":
		if method == http.MethodPost {
			return permissionDataRead, true
		}
	}

	return "", false
}

func permissionForEvalRoute(method string, path string) (string, bool) {
	switch method {
	case http.MethodGet:
		return permissionDataRead, true
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return permissionEvalWrite, true
	default:
		return "", false
	}
}

func (a *App) handleListConversations(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/conversations", http.MethodGet)
}

func (a *App) handleConversationRoutes(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/query/conversations/")
	if id == "" || strings.Contains(id, "/") {
		parts := strings.Split(id, "/")
		if len(parts) != 2 || parts[0] == "" {
			http.Error(w, "invalid conversation path", http.StatusBadRequest)
			return
		}
		id = parts[0]
		child := parts[1]
		switch child {
		case "ratings", "annotations":
			path := fmt.Sprintf("/api/v1/conversations/%s/%s", id, child)
			switch req.Method {
			case http.MethodGet, http.MethodPost:
				a.handleProxy(w, req, path, req.Method)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
		case "followup":
			a.handleProxy(w, req, fmt.Sprintf("/api/v1/conversations/%s/followup", id), http.MethodPost)
		default:
			http.Error(w, "invalid conversation path", http.StatusBadRequest)
		}
		return
	}

	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.handleProxy(w, req, fmt.Sprintf("/api/v1/conversations/%s", id), http.MethodGet)
}

func (a *App) handleConversationRoutesV2(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/query/v2/conversations/")
	if id == "" || strings.Contains(id, "/") {
		http.Error(w, "invalid conversation path", http.StatusBadRequest)
		return
	}

	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.handleProxy(w, req, fmt.Sprintf("/api/v2/conversations/%s", id), http.MethodGet)
}

func (a *App) handleGenerationRoutes(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/query/generations/")
	if id == "" || strings.Contains(id, "/") {
		http.Error(w, "invalid generation path", http.StatusBadRequest)
		return
	}
	a.handleProxy(w, req, fmt.Sprintf("/api/v1/generations/%s", id), http.MethodGet)
}

func (a *App) handleSettingsRoutes(w http.ResponseWriter, req *http.Request) {
	switch req.URL.Path {
	case "/query/settings":
		a.handleProxy(w, req, "/api/v1/settings", http.MethodGet)
	case "/query/settings/datasources":
		if req.Method != http.MethodPut {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		a.handleProxy(w, req, "/api/v1/settings/datasources", http.MethodPut)
	default:
		http.NotFound(w, req)
	}
}

func (a *App) handlePrometheusProxyRoutes(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet && req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !a.hasGrafanaDatasourceProxyTarget(a.prometheusDatasourceUID) {
		http.Error(w, "grafana prometheus datasource proxy is not configured", http.StatusServiceUnavailable)
		return
	}
	a.handleGrafanaDatasourceProxy(
		w,
		req,
		"/query/proxy/prometheus/",
		fmt.Sprintf("/api/datasources/uid/%s/resources", a.prometheusDatasourceUID),
	)
}

func (a *App) handleTempoProxyRoutes(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !a.hasGrafanaDatasourceProxyTarget(a.tempoDatasourceUID) {
		http.Error(w, "grafana tempo datasource proxy is not configured", http.StatusServiceUnavailable)
		return
	}
	a.handleGrafanaDatasourceProxy(
		w,
		req,
		"/query/proxy/tempo/",
		fmt.Sprintf("/api/datasources/proxy/uid/%s", a.tempoDatasourceUID),
	)
}

func (a *App) hasGrafanaDatasourceProxyTarget(datasourceUID string) bool {
	return strings.TrimSpace(datasourceUID) != "" &&
		strings.TrimSpace(a.grafanaAppURL) != ""
}

func (a *App) handleGrafanaDatasourceProxy(w http.ResponseWriter, req *http.Request, routePrefix string, datasourcePrefix string) {
	downstreamPath, ok := downstreamProxyPath(req.URL.Path, routePrefix)
	if !ok {
		http.Error(w, "invalid proxy path", http.StatusBadRequest)
		return
	}
	a.handleGrafanaProxy(w, req, datasourcePrefix+downstreamPath, req.Method)
}

func downstreamProxyPath(path string, routePrefix string) (string, bool) {
	if !strings.HasPrefix(path, routePrefix) {
		return "", false
	}
	downstream := strings.TrimSpace(strings.TrimPrefix(path, routePrefix))
	if downstream == "" {
		return "", false
	}
	downstream = "/" + strings.TrimPrefix(downstream, "/")
	if downstream == "/" {
		return "", false
	}
	return downstream, true
}

func parseSearchTagValuesPath(path string, escapedPath string, routePrefix string) (string, bool) {
	if escapedPath == "" {
		escapedPath = path
	}

	trimmed := strings.TrimPrefix(escapedPath, routePrefix)
	if trimmed == escapedPath || trimmed == "" || !strings.HasSuffix(trimmed, "/values") {
		return "", false
	}

	tagEscaped := strings.TrimSuffix(trimmed, "/values")
	if tagEscaped == "" || strings.HasPrefix(tagEscaped, "/") || strings.HasSuffix(tagEscaped, "/") {
		return "", false
	}

	tag, err := url.PathUnescape(tagEscaped)
	if err != nil {
		return "", false
	}
	if strings.TrimSpace(tag) == "" {
		return "", false
	}
	return tag, true
}

var hopByHopResponseHeaders = map[string]struct{}{
	"Connection":          {},
	"Keep-Alive":          {},
	"Proxy-Authenticate":  {},
	"Proxy-Authorization": {},
	"Te":                  {},
	"Trailer":             {},
	"Transfer-Encoding":   {},
	"Upgrade":             {},
}

func isConnectionHeader(name string, connectionValues []string) bool {
	for _, raw := range connectionValues {
		for _, token := range strings.Split(raw, ",") {
			if http.CanonicalHeaderKey(strings.TrimSpace(token)) == name {
				return true
			}
		}
	}
	return false
}

func copyUpstreamResponseHeaders(dst http.Header, src http.Header) {
	connectionValues := src.Values("Connection")
	for key, values := range src {
		canonical := http.CanonicalHeaderKey(key)
		if _, skip := hopByHopResponseHeaders[canonical]; skip {
			continue
		}
		if isConnectionHeader(canonical, connectionValues) {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func (a *App) handleProxy(w http.ResponseWriter, req *http.Request, path string, method string) {
	if req.Method != method {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, span := pluginProxyTracer.Start(
		req.Context(),
		"sigil.plugin.proxy.sigil",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("http.request.method", method),
			attribute.String("url.path", path),
		),
	)
	defer span.End()

	upstream := strings.TrimRight(a.apiURL, "/") + path
	if req.URL.RawQuery != "" {
		upstream += "?" + req.URL.RawQuery
	}

	var body io.Reader
	if req.Body != nil {
		body = req.Body
	}
	proxyReq, err := http.NewRequestWithContext(ctx, method, upstream, body)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "build request")
		writeStub(w, http.StatusInternalServerError, path, fmt.Sprintf("build request: %v", err))
		return
	}
	proxyReq.Header = req.Header.Clone()
	if a.apiAuthToken != "" {
		proxyReq.SetBasicAuth(a.tenantID, a.apiAuthToken)
	}
	injectTenantHeaders(proxyReq, a.tenantID)
	injectGrafanaUserHeader(proxyReq, method, path)
	injectOperatorIdentityHeaders(proxyReq, method, path)
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(proxyReq.Header))

	resp, err := a.client.Do(proxyReq)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "upstream unavailable")
		writeStub(w, http.StatusBadGateway, path, fmt.Sprintf("upstream unavailable: %v", err))
		return
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			// Best-effort close after response handling; no recovery path here.
			_ = closeErr
		}
	}()

	copyUpstreamResponseHeaders(w.Header(), resp.Header)
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(resp.StatusCode)
	span.SetAttributes(attribute.Int("http.response.status_code", resp.StatusCode))
	if resp.StatusCode >= http.StatusInternalServerError {
		span.SetStatus(codes.Error, http.StatusText(resp.StatusCode))
	}
	_, _ = io.Copy(w, resp.Body)
}

func (a *App) handleProxyWithBody(w http.ResponseWriter, req *http.Request, path string, method string, body []byte) {
	ctx, span := pluginProxyTracer.Start(
		req.Context(),
		"sigil.plugin.proxy.sigil",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("http.request.method", method),
			attribute.String("url.path", path),
		),
	)
	defer span.End()

	upstream := strings.TrimRight(a.apiURL, "/") + path

	proxyReq, err := http.NewRequestWithContext(ctx, method, upstream, bytes.NewReader(body))
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "build request")
		writeStub(w, http.StatusInternalServerError, path, fmt.Sprintf("build request: %v", err))
		return
	}
	proxyReq.Header = req.Header.Clone()
	proxyReq.Header.Set("Content-Type", "application/json")
	if a.apiAuthToken != "" {
		proxyReq.SetBasicAuth(a.tenantID, a.apiAuthToken)
	}
	injectTenantHeaders(proxyReq, a.tenantID)
	injectGrafanaUserHeader(proxyReq, method, path)
	injectOperatorIdentityHeaders(proxyReq, method, path)
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(proxyReq.Header))

	resp, err := a.client.Do(proxyReq)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "upstream unavailable")
		writeStub(w, http.StatusBadGateway, path, fmt.Sprintf("upstream unavailable: %v", err))
		return
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			_ = closeErr
		}
	}()

	copyUpstreamResponseHeaders(w.Header(), resp.Header)
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(resp.StatusCode)
	span.SetAttributes(attribute.Int("http.response.status_code", resp.StatusCode))
	if resp.StatusCode >= http.StatusInternalServerError {
		span.SetStatus(codes.Error, http.StatusText(resp.StatusCode))
	}
	_, _ = io.Copy(w, resp.Body)
}

func (a *App) handleGrafanaProxy(w http.ResponseWriter, req *http.Request, path string, method string) {
	if req.Method != method {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, span := pluginProxyTracer.Start(
		req.Context(),
		"sigil.plugin.proxy.grafana",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("http.request.method", method),
			attribute.String("url.path", path),
		),
	)
	defer span.End()

	upstream := strings.TrimRight(a.grafanaAppURL, "/") + path
	if req.URL.RawQuery != "" {
		upstream += "?" + req.URL.RawQuery
	}

	var body io.Reader
	if req.Body != nil {
		body = req.Body
	}
	proxyReq, err := http.NewRequestWithContext(ctx, method, upstream, body)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "build request")
		writeStub(w, http.StatusInternalServerError, path, fmt.Sprintf("build request: %v", err))
		return
	}

	proxyReq.Header = req.Header.Clone()
	if token := strings.TrimSpace(a.grafanaServiceAccountToken); token != "" {
		proxyReq.Header.Set("Authorization", "Bearer "+token)
	}
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(proxyReq.Header))

	resp, err := a.client.Do(proxyReq)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "upstream unavailable")
		writeStub(w, http.StatusBadGateway, path, fmt.Sprintf("upstream unavailable: %v", err))
		return
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			_ = closeErr
		}
	}()

	copyUpstreamResponseHeaders(w.Header(), resp.Header)
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(resp.StatusCode)
	span.SetAttributes(attribute.Int("http.response.status_code", resp.StatusCode))
	if resp.StatusCode >= http.StatusInternalServerError {
		span.SetStatus(codes.Error, http.StatusText(resp.StatusCode))
	}
	_, _ = io.Copy(w, resp.Body)
}

func writeStub(w http.ResponseWriter, status int, endpoint string, err string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(stubResponse{
		Status:   "stub",
		Source:   "grafana-sigil-app",
		Endpoint: endpoint,
		Error:    err,
	})
}

func injectOperatorIdentityHeaders(proxyReq *http.Request, method string, path string) {
	if proxyReq == nil || method != http.MethodPost || !strings.HasSuffix(path, "/annotations") {
		return
	}
	if strings.TrimSpace(proxyReq.Header.Get("X-Sigil-Operator-Id")) != "" {
		return
	}

	user := backend.UserFromContext(proxyReq.Context())
	if user == nil {
		return
	}

	operatorID := strings.TrimSpace(user.Login)
	if operatorID == "" {
		operatorID = strings.TrimSpace(user.Email)
	}
	if operatorID != "" {
		proxyReq.Header.Set("X-Sigil-Operator-Id", operatorID)
	}
	if login := strings.TrimSpace(user.Login); login != "" {
		proxyReq.Header.Set("X-Sigil-Operator-Login", login)
	}
	if name := strings.TrimSpace(user.Name); name != "" {
		proxyReq.Header.Set("X-Sigil-Operator-Name", name)
	}
}

func injectGrafanaUserHeader(proxyReq *http.Request, method string, path string) {
	if proxyReq == nil {
		return
	}
	if strings.HasPrefix(path, "/api/v1/eval") {
		proxyReq.Header.Del(headerGrafanaUser)
		proxyReq.Header.Del(headerSigilTrustedActor)
	}
	if !shouldInjectGrafanaUser(method, path) {
		return
	}

	user := backend.UserFromContext(proxyReq.Context())
	if user == nil {
		return
	}

	actorID := strings.TrimSpace(user.Email)
	if actorID == "" {
		actorID = strings.TrimSpace(user.Login)
	}
	if actorID != "" {
		proxyReq.Header.Set(headerGrafanaUser, actorID)
		proxyReq.Header.Set(headerSigilTrustedActor, "true")
	}
}

func shouldInjectGrafanaUser(method string, path string) bool {
	if !strings.HasPrefix(path, "/api/v1/eval") {
		return false
	}
	if method != http.MethodPost && method != http.MethodPatch {
		return false
	}
	switch path {
	case "/api/v1/eval:test", "/api/v1/eval/rules:preview":
		return false
	default:
		return true
	}
}

func injectTenantHeaders(proxyReq *http.Request, fallbackTenantID string) {
	if proxyReq == nil {
		return
	}
	if strings.TrimSpace(proxyReq.Header.Get("X-Scope-OrgID")) != "" {
		return
	}
	// Do not derive Sigil tenant from Grafana org headers; only explicit
	// tenant headers or configured plugin fallback are allowed.
	if fallback := strings.TrimSpace(fallbackTenantID); fallback != "" {
		proxyReq.Header.Set("X-Scope-OrgID", fallback)
	}
}

func (a *App) handleListModelCards(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/model-cards", http.MethodGet)
}

func (a *App) handleLookupModelCard(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/model-cards:lookup", http.MethodGet)
}

func (a *App) handleListAgents(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/agents", http.MethodGet)
}

func (a *App) handleLookupAgent(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/agents:lookup", http.MethodGet)
}

func (a *App) handleListAgentVersions(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/agents:versions", http.MethodGet)
}

func (a *App) handleLookupAgentRating(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/agents:rating", http.MethodGet)
}

func (a *App) handleRateAgent(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/agents:rate", http.MethodPost)
}

func (a *App) handleLookupPromptInsights(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/agents:prompt-insights", http.MethodGet)
}

const (
	analyzePromptConversationLimit = 15
	analyzePromptDetailBatchSize   = 5
	analyzePromptDefaultLookback   = 7 * 24 * time.Hour
)

var analyzePromptValidLookbacks = map[string]time.Duration{
	"6h":  6 * time.Hour,
	"12h": 12 * time.Hour,
	"1d":  24 * time.Hour,
	"3d":  3 * 24 * time.Hour,
	"7d":  7 * 24 * time.Hour,
}

func parseAnalyzePromptLookback(raw string) time.Duration {
	if d, ok := analyzePromptValidLookbacks[strings.TrimSpace(raw)]; ok {
		return d
	}
	return analyzePromptDefaultLookback
}

type analyzePromptPluginRequest struct {
	AgentName string `json:"agent_name"`
	Version   string `json:"version,omitempty"`
	Model     string `json:"model,omitempty"`
	Lookback  string `json:"lookback,omitempty"`
}

type analyzePromptExcerpt struct {
	ConversationID  string `json:"conversation_id"`
	GenerationCount int    `json:"generation_count"`
	HasErrors       bool   `json:"has_errors"`
	ToolCallCount   int    `json:"tool_call_count"`
	UserInput       string `json:"user_input"`
	AssistantOutput string `json:"assistant_output"`
}

type analyzePromptWithExcerptsUpstream struct {
	AgentName string                 `json:"agent_name"`
	Version   string                 `json:"version,omitempty"`
	Model     string                 `json:"model,omitempty"`
	Excerpts  []analyzePromptExcerpt `json:"excerpts"`
}

func (a *App) handleAnalyzePrompt(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload analyzePromptPluginRequest
	if req.Body != nil {
		decoder := json.NewDecoder(req.Body)
		if err := decoder.Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
	}

	agentName := strings.TrimSpace(payload.AgentName)
	if agentName == "" {
		http.Error(w, "agent_name is required", http.StatusBadRequest)
		return
	}

	// req.Body is consumed by the decoder above, so re-encode for fallback paths.
	rawBody, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, "failed to re-encode request body", http.StatusInternalServerError)
		return
	}

	if !a.hasGrafanaDatasourceProxyTarget(a.tempoDatasourceUID) {
		a.handleProxyWithBody(w, req, "/api/v1/agents:analyze-prompt", http.MethodPost, rawBody)
		return
	}

	lookback := parseAnalyzePromptLookback(payload.Lookback)
	now := time.Now().UTC()
	searchPayload := conversationSearchRequest{
		Filters: fmt.Sprintf("agent = %q", agentName),
		TimeRange: conversationSearchTimeRange{
			From: now.Add(-lookback),
			To:   now,
		},
		PageSize: analyzePromptConversationLimit,
	}

	searchResp, err := a.searchConversations(req, searchPayload)
	if err != nil {
		backend.Logger.Warn("analyze-prompt: conversation search failed, falling back to proxy",
			"agent_name", agentName,
			"error", err,
		)
		a.handleProxyWithBody(w, req, "/api/v1/agents:analyze-prompt", http.MethodPost, rawBody)
		return
	}

	excerpts := a.fetchConversationExcerptsParallel(req, agentName, searchResp.Conversations)

	upstream := analyzePromptWithExcerptsUpstream{
		AgentName: payload.AgentName,
		Version:   payload.Version,
		Model:     payload.Model,
		Excerpts:  excerpts,
	}

	body, err := json.Marshal(upstream)
	if err != nil {
		http.Error(w, "failed to encode upstream request", http.StatusInternalServerError)
		return
	}
	a.handleProxyWithBody(w, req, "/api/v1/agents:analyze-prompt-with-excerpts", http.MethodPost, body)
}

func (a *App) fetchConversationExcerptsParallel(
	req *http.Request,
	agentName string,
	conversations []conversationSearchResult,
) []analyzePromptExcerpt {
	if len(conversations) == 0 {
		return []analyzePromptExcerpt{}
	}

	type indexedExcerpt struct {
		index   int
		excerpt analyzePromptExcerpt
	}

	results := make(chan indexedExcerpt, len(conversations))
	sem := make(chan struct{}, analyzePromptDetailBatchSize)

	for i, conv := range conversations {
		sem <- struct{}{}
		go func(idx int, conversationID string, hasErrors bool) {
			defer func() { <-sem }()

			var detail conversationDetailResponse
			if err := a.doSigilJSONRequest(
				req,
				http.MethodGet,
				fmt.Sprintf("/api/v1/conversations/%s", url.PathEscape(conversationID)),
				nil, nil, &detail,
			); err != nil {
				backend.Logger.Debug("analyze-prompt: failed to fetch conversation detail",
					"conversation_id", conversationID,
					"error", err,
				)
				return
			}

			agentGens := make([]generationPayload, 0)
			for _, g := range detail.Generations {
				if an, _ := g["agent_name"].(string); an == agentName {
					agentGens = append(agentGens, g)
				}
			}
			if len(agentGens) == 0 {
				return
			}

			excerpt := analyzePromptExcerpt{
				ConversationID:  conversationID,
				GenerationCount: len(agentGens),
				HasErrors:       hasErrors,
				UserInput:       extractGenerationMessageText(agentGens[0], "input"),
				AssistantOutput: extractGenerationMessageText(agentGens[0], "output"),
			}
			for _, g := range agentGens {
				excerpt.ToolCallCount += countGenerationToolCalls(g)
			}

			results <- indexedExcerpt{index: idx, excerpt: excerpt}
		}(i, conv.ConversationID, conv.HasErrors)
	}

	for i := 0; i < cap(sem); i++ {
		sem <- struct{}{}
	}
	close(results)

	excerpts := make([]analyzePromptExcerpt, 0, len(conversations))
	collected := make([]indexedExcerpt, 0, len(conversations))
	for r := range results {
		collected = append(collected, r)
	}
	sort.Slice(collected, func(i, j int) bool {
		return collected[i].index < collected[j].index
	})
	for _, c := range collected {
		excerpts = append(excerpts, c.excerpt)
	}
	return excerpts
}

type generationPayload = map[string]any

type conversationDetailResponse struct {
	ConversationID string              `json:"conversation_id"`
	Generations    []generationPayload `json:"generations"`
}

func extractGenerationMessageText(gen generationPayload, field string) string {
	messages, ok := gen[field].([]any)
	if !ok || len(messages) == 0 {
		return ""
	}
	msg, ok := messages[0].(map[string]any)
	if !ok {
		return ""
	}
	parts, ok := msg["parts"].([]any)
	if !ok || len(parts) == 0 {
		return ""
	}
	part, ok := parts[0].(map[string]any)
	if !ok {
		return ""
	}
	text, _ := part["text"].(string)
	return text
}

func countGenerationToolCalls(gen generationPayload) int {
	output, ok := gen["output"].([]any)
	if !ok {
		return 0
	}
	count := 0
	for _, msg := range output {
		m, ok := msg.(map[string]any)
		if !ok {
			continue
		}
		parts, ok := m["parts"].([]any)
		if !ok {
			continue
		}
		for _, part := range parts {
			p, ok := part.(map[string]any)
			if !ok {
				continue
			}
			if _, hasToolCall := p["tool_call"]; hasToolCall {
				count++
			}
		}
	}
	return count
}

func (a *App) handleEvalEvaluators(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, "/api/v1/eval/evaluators", http.MethodGet)
	case http.MethodPost:
		a.handleProxy(w, req, "/api/v1/eval/evaluators", http.MethodPost)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalEvaluatorByID(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/eval/evaluators/")
	if id == "" || strings.Contains(id, "/") {
		http.Error(w, "invalid evaluator path", http.StatusBadRequest)
		return
	}
	path := fmt.Sprintf("/api/v1/eval/evaluators/%s", id)
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, path, http.MethodGet)
	case http.MethodDelete:
		a.handleProxy(w, req, path, http.MethodDelete)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalPredefinedEvaluators(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/eval/predefined/evaluators", http.MethodGet)
}

func (a *App) handleEvalPredefinedFork(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/eval/predefined/evaluators/")
	if id == "" || strings.Contains(id, "/") || !strings.HasSuffix(id, ":fork") {
		http.Error(w, "invalid predefined evaluator fork path", http.StatusBadRequest)
		return
	}
	path := fmt.Sprintf("/api/v1/eval/predefined/evaluators/%s", id)
	a.handleProxy(w, req, path, http.MethodPost)
}

func (a *App) handleEvalRulesPreview(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/eval/rules:preview", http.MethodPost)
}

func (a *App) handleEvalTest(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/eval:test", http.MethodPost)
}

func (a *App) handleEvalRules(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, "/api/v1/eval/rules", http.MethodGet)
	case http.MethodPost:
		a.handleProxy(w, req, "/api/v1/eval/rules", http.MethodPost)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalRuleByID(w http.ResponseWriter, req *http.Request) {
	pathForID := req.URL.RawPath
	if pathForID == "" {
		pathForID = req.URL.Path
	}
	idEncoded := strings.TrimPrefix(pathForID, "/eval/rules/")
	if idEncoded == "" {
		http.Error(w, "invalid rule path", http.StatusBadRequest)
		return
	}
	// When using Path only, reject literal slashes (ambiguous with subpaths).
	// Mirrors backend pathIDEscaped guard.
	if pathForID == req.URL.Path && strings.Contains(idEncoded, "/") {
		http.Error(w, "invalid rule path", http.StatusBadRequest)
		return
	}
	id, err := url.PathUnescape(idEncoded)
	if err != nil || id == "" {
		http.Error(w, "invalid rule path", http.StatusBadRequest)
		return
	}
	path := fmt.Sprintf("/api/v1/eval/rules/%s", url.PathEscape(id))
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, path, http.MethodGet)
	case http.MethodPatch:
		a.handleProxy(w, req, path, http.MethodPatch)
	case http.MethodDelete:
		a.handleProxy(w, req, path, http.MethodDelete)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalJudgeProviders(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/eval/judge/providers", http.MethodGet)
}

func (a *App) handleEvalJudgeModels(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/eval/judge/models", http.MethodGet)
}

func (a *App) handleEvalTemplates(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, "/api/v1/eval/templates", http.MethodGet)
	case http.MethodPost:
		a.handleProxy(w, req, "/api/v1/eval/templates", http.MethodPost)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalTemplateRoutes(w http.ResponseWriter, req *http.Request) {
	subpath := strings.TrimPrefix(req.URL.Path, "/eval/templates/")
	if subpath == "" {
		http.Error(w, "invalid template path", http.StatusBadRequest)
		return
	}

	// Check for {id}:fork action.
	if strings.HasSuffix(subpath, ":fork") && !strings.Contains(subpath, "/") {
		id := strings.TrimSuffix(subpath, ":fork")
		if id == "" {
			http.Error(w, "invalid template fork path", http.StatusBadRequest)
			return
		}
		path := fmt.Sprintf("/api/v1/eval/templates/%s:fork", id)
		a.handleProxy(w, req, path, http.MethodPost)
		return
	}

	parts := strings.SplitN(subpath, "/", 3)
	switch len(parts) {
	case 1:
		// {id} — get or delete by ID.
		id := parts[0]
		if id == "" {
			http.Error(w, "invalid template path", http.StatusBadRequest)
			return
		}
		path := fmt.Sprintf("/api/v1/eval/templates/%s", id)
		switch req.Method {
		case http.MethodGet:
			a.handleProxy(w, req, path, http.MethodGet)
		case http.MethodDelete:
			a.handleProxy(w, req, path, http.MethodDelete)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	case 2:
		// {id}/versions — list or publish versions.
		id := parts[0]
		if id == "" || parts[1] != "versions" {
			http.Error(w, "invalid template path", http.StatusBadRequest)
			return
		}
		path := fmt.Sprintf("/api/v1/eval/templates/%s/versions", id)
		switch req.Method {
		case http.MethodGet:
			a.handleProxy(w, req, path, http.MethodGet)
		case http.MethodPost:
			a.handleProxy(w, req, path, http.MethodPost)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	case 3:
		// {id}/versions/{v} — get specific version.
		id := parts[0]
		if id == "" || parts[1] != "versions" || parts[2] == "" {
			http.Error(w, "invalid template path", http.StatusBadRequest)
			return
		}
		path := fmt.Sprintf("/api/v1/eval/templates/%s/versions/%s", id, parts[2])
		a.handleProxy(w, req, path, http.MethodGet)
	default:
		http.Error(w, "invalid template path", http.StatusBadRequest)
	}
}

func (a *App) handleEvalSavedConversations(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, "/api/v1/eval/saved-conversations", http.MethodGet)
	case http.MethodPost:
		a.handleProxy(w, req, "/api/v1/eval/saved-conversations", http.MethodPost)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalSavedConversationByID(w http.ResponseWriter, req *http.Request) {
	rest := strings.TrimPrefix(req.URL.Path, "/eval/saved-conversations/")
	if rest == "" {
		http.Error(w, "invalid saved conversation path", http.StatusBadRequest)
		return
	}

	// Handle {saved_id}/collections sub-path
	if strings.HasSuffix(rest, "/collections") {
		savedID := strings.TrimSuffix(rest, "/collections")
		if savedID == "" || strings.Contains(savedID, "/") {
			http.Error(w, "invalid saved conversation path", http.StatusBadRequest)
			return
		}
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		path := fmt.Sprintf("/api/v1/eval/saved-conversations/%s/collections", savedID)
		a.handleProxy(w, req, path, http.MethodGet)
		return
	}

	// Existing behavior: {saved_id} only
	if strings.Contains(rest, "/") {
		http.Error(w, "invalid saved conversation path", http.StatusBadRequest)
		return
	}
	path := fmt.Sprintf("/api/v1/eval/saved-conversations/%s", rest)
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, path, http.MethodGet)
	case http.MethodDelete:
		a.handleProxy(w, req, path, http.MethodDelete)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalSavedConversationsManual(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.handleProxy(w, req, "/api/v1/eval/saved-conversations:manual", http.MethodPost)
}

func (a *App) handleEvalCollections(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, "/api/v1/eval/collections", http.MethodGet)
	case http.MethodPost:
		a.handleProxy(w, req, "/api/v1/eval/collections", http.MethodPost)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleEvalCollectionRoutes(w http.ResponseWriter, req *http.Request) {
	rest := strings.TrimPrefix(req.URL.Path, "/eval/collections/")
	if rest == "" {
		http.Error(w, "invalid collection path", http.StatusBadRequest)
		return
	}
	// Validate path structure: {id}, {id}/members, or {id}/members/{saved_id}.
	segments := strings.Split(rest, "/")
	switch len(segments) {
	case 1: // {collection_id}
	case 2: // {collection_id}/members
		if segments[1] != "members" {
			http.Error(w, "invalid collection path", http.StatusBadRequest)
			return
		}
	case 3: // {collection_id}/members/{saved_id}
		if segments[1] != "members" {
			http.Error(w, "invalid collection path", http.StatusBadRequest)
			return
		}
	default:
		http.Error(w, "invalid collection path", http.StatusBadRequest)
		return
	}
	for _, seg := range segments {
		if seg == "" || seg == "." || seg == ".." {
			http.Error(w, "invalid collection path", http.StatusBadRequest)
			return
		}
	}
	path := "/api/v1/eval/collections/" + rest
	switch req.Method {
	case http.MethodGet:
		a.handleProxy(w, req, path, http.MethodGet)
	case http.MethodPost:
		a.handleProxy(w, req, path, http.MethodPost)
	case http.MethodPatch:
		a.handleProxy(w, req, path, http.MethodPatch)
	case http.MethodDelete:
		a.handleProxy(w, req, path, http.MethodDelete)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/query/conversations/search", a.withAuthorization(a.handleSearchConversations))
	mux.HandleFunc("/query/conversations/search/stream", a.withAuthorization(a.handleSearchConversationsStream))
	mux.HandleFunc("/query/conversations/stats", a.withAuthorization(a.handleConversationStats))
	mux.HandleFunc("/query/conversations", a.withAuthorization(a.handleListConversations))
	mux.HandleFunc("/query/conversations/", a.withAuthorization(a.handleConversationRoutes))
	mux.HandleFunc("/query/v2/conversations/", a.withAuthorization(a.handleConversationRoutesV2))
	mux.HandleFunc("/query/generations/", a.withAuthorization(a.handleGenerationRoutes))
	mux.HandleFunc("/query/search/tags", a.withAuthorization(a.handleSearchTags))
	mux.HandleFunc("/query/search/tag/", a.withAuthorization(a.handleSearchTagValues))
	mux.HandleFunc("/query/settings", a.withAuthorization(a.handleSettingsRoutes))
	mux.HandleFunc("/query/settings/datasources", a.withAuthorization(a.handleSettingsRoutes))
	mux.HandleFunc("/query/proxy/prometheus/", a.withAuthorization(a.handlePrometheusProxyRoutes))
	mux.HandleFunc("/query/proxy/tempo/", a.withAuthorization(a.handleTempoProxyRoutes))
	mux.HandleFunc("/query/model-cards", a.withAuthorization(a.handleListModelCards))
	mux.HandleFunc("/query/model-cards/lookup", a.withAuthorization(a.handleLookupModelCard))
	mux.HandleFunc("/query/agents", a.withAuthorization(a.handleListAgents))
	mux.HandleFunc("/query/agents/lookup", a.withAuthorization(a.handleLookupAgent))
	mux.HandleFunc("/query/agents/versions", a.withAuthorization(a.handleListAgentVersions))
	mux.HandleFunc("/query/agents/rating", a.withAuthorization(a.handleLookupAgentRating))
	mux.HandleFunc("/query/agents/rate", a.withAuthorization(a.handleRateAgent))
	mux.HandleFunc("/query/agents/prompt-insights", a.withAuthorization(a.handleLookupPromptInsights))
	mux.HandleFunc("/query/agents/analyze-prompt", a.withAuthorization(a.handleAnalyzePrompt))

	mux.HandleFunc("/eval/evaluators", a.withAuthorization(a.handleEvalEvaluators))
	mux.HandleFunc("/eval/evaluators/", a.withAuthorization(a.handleEvalEvaluatorByID))
	mux.HandleFunc("/eval/predefined/evaluators", a.withAuthorization(a.handleEvalPredefinedEvaluators))
	mux.HandleFunc("/eval/predefined/evaluators/", a.withAuthorization(a.handleEvalPredefinedFork))
	mux.HandleFunc("/eval/rules:preview", a.withAuthorization(a.handleEvalRulesPreview))
	mux.HandleFunc("/eval:test", a.withAuthorization(a.handleEvalTest))
	mux.HandleFunc("/eval/rules", a.withAuthorization(a.handleEvalRules))
	mux.HandleFunc("/eval/rules/", a.withAuthorization(a.handleEvalRuleByID))
	mux.HandleFunc("/eval/judge/providers", a.withAuthorization(a.handleEvalJudgeProviders))
	mux.HandleFunc("/eval/judge/models", a.withAuthorization(a.handleEvalJudgeModels))
	mux.HandleFunc("/eval/templates", a.withAuthorization(a.handleEvalTemplates))
	mux.HandleFunc("/eval/templates/", a.withAuthorization(a.handleEvalTemplateRoutes))
	mux.HandleFunc("/eval/saved-conversations", a.withAuthorization(a.handleEvalSavedConversations))
	mux.HandleFunc("/eval/saved-conversations/", a.withAuthorization(a.handleEvalSavedConversationByID))
	mux.HandleFunc("/eval/saved-conversations:manual", a.withAuthorization(a.handleEvalSavedConversationsManual))
	mux.HandleFunc("/eval/collections", a.withAuthorization(a.handleEvalCollections))
	mux.HandleFunc("/eval/collections/", a.withAuthorization(a.handleEvalCollectionRoutes))
}

type conversationSearchTimeRange struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

type conversationSearchRequest struct {
	Filters   string                      `json:"filters"`
	Select    []string                    `json:"select"`
	TimeRange conversationSearchTimeRange `json:"time_range"`
	PageSize  int                         `json:"page_size"`
	Cursor    string                      `json:"cursor"`
}

type conversationRatingSummary struct {
	TotalCount    int       `json:"total_count"`
	GoodCount     int       `json:"good_count"`
	BadCount      int       `json:"bad_count"`
	LatestRating  string    `json:"latest_rating,omitempty"`
	LatestRatedAt time.Time `json:"latest_rated_at"`
	LatestBadAt   time.Time `json:"latest_bad_at,omitempty"`
	HasBadRating  bool      `json:"has_bad_rating"`
}

type conversationEvalSummary struct {
	TotalScores int `json:"total_scores"`
	PassCount   int `json:"pass_count"`
	FailCount   int `json:"fail_count"`
}

type conversationSearchResult struct {
	ConversationID    string                     `json:"conversation_id"`
	ConversationTitle string                     `json:"conversation_title,omitempty"`
	UserID            string                     `json:"user_id,omitempty"`
	GenerationCount   int                        `json:"generation_count"`
	FirstGenerationAt time.Time                  `json:"first_generation_at"`
	LastGenerationAt  time.Time                  `json:"last_generation_at"`
	Models            []string                   `json:"models"`
	ModelProviders    map[string]string          `json:"model_providers,omitempty"`
	Agents            []string                   `json:"agents"`
	ErrorCount        int                        `json:"error_count"`
	HasErrors         bool                       `json:"has_errors"`
	TraceIDs          []string                   `json:"trace_ids"`
	RatingSummary     *conversationRatingSummary `json:"rating_summary,omitempty"`
	AnnotationCount   int                        `json:"annotation_count"`
	EvalSummary       *conversationEvalSummary   `json:"eval_summary,omitempty"`
	Selected          map[string]any             `json:"selected,omitempty"`
}

type conversationSearchResponse struct {
	Conversations []conversationSearchResult `json:"conversations"`
	NextCursor    string                     `json:"next_cursor"`
	HasMore       bool                       `json:"has_more"`
}

type conversationStatsResponse struct {
	TotalConversations      int     `json:"totalConversations"`
	TotalTokens             float64 `json:"totalTokens"`
	AvgCallsPerConversation float64 `json:"avgCallsPerConversation"`
	ActiveLast7d            int     `json:"activeLast7d"`
	RatedConversations      int     `json:"ratedConversations"`
	BadRatedPct             float64 `json:"badRatedPct"`
}

type conversationSearchStreamResultsEvent struct {
	Type          string                     `json:"type"`
	Conversations []conversationSearchResult `json:"conversations"`
}

type conversationSearchStreamCompleteEvent struct {
	Type       string `json:"type"`
	NextCursor string `json:"next_cursor,omitempty"`
	HasMore    bool   `json:"has_more"`
}

type conversationSearchStreamErrorEvent struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type conversationSearchState struct {
	Results    []conversationSearchResult
	NextCursor string
	HasMore    bool
}

const conversationSearchMetadataChunkSize = 100
const conversationSearchStreamOverfetchMultiplier = searchcore.DefaultTempoOverfetchMultiplier * 2
const conversationSearchInputTokensSelectKey = "span.gen_ai.usage.input_tokens"
const conversationSearchOutputTokensSelectKey = "span.gen_ai.usage.output_tokens"
const conversationSearchCacheReadTokensSelectKey = "span.gen_ai.usage.cache_read_input_tokens"
const conversationSearchCacheWriteTokensSelectKey = "span.gen_ai.usage.cache_write_input_tokens"
const conversationSearchReasoningTokensSelectKey = "span.gen_ai.usage.reasoning_tokens"
const maxStatsSearchPages = 1000

type conversationBatchMetadataRequest struct {
	ConversationIDs []string `json:"conversation_ids"`
}

type conversationBatchMetadata struct {
	ConversationID    string                     `json:"conversation_id"`
	ConversationTitle string                     `json:"conversation_title,omitempty"`
	UserID            string                     `json:"user_id,omitempty"`
	GenerationCount   int                        `json:"generation_count"`
	FirstGenerationAt time.Time                  `json:"first_generation_at"`
	LastGenerationAt  time.Time                  `json:"last_generation_at"`
	Models            []string                   `json:"models"`
	ModelProviders    map[string]string          `json:"model_providers,omitempty"`
	Agents            []string                   `json:"agents"`
	ErrorCount        int                        `json:"error_count"`
	HasErrors         bool                       `json:"has_errors"`
	InputTokens       int64                      `json:"input_tokens"`
	OutputTokens      int64                      `json:"output_tokens"`
	CacheReadTokens   int64                      `json:"cache_read_tokens"`
	CacheWriteTokens  int64                      `json:"cache_write_tokens"`
	ReasoningTokens   int64                      `json:"reasoning_tokens"`
	TotalTokens       int64                      `json:"total_tokens"`
	RatingSummary     *conversationRatingSummary `json:"rating_summary,omitempty"`
	AnnotationCount   int                        `json:"annotation_count"`
	EvalSummary       *conversationEvalSummary   `json:"eval_summary,omitempty"`
}

type conversationBatchMetadataResponse struct {
	Items                  []conversationBatchMetadata `json:"items"`
	MissingConversationIDs []string                    `json:"missing_conversation_ids"`
}

type upstreamHTTPError struct {
	StatusCode int
	Body       []byte
}

func (e *upstreamHTTPError) Error() string {
	trimmed := strings.TrimSpace(string(e.Body))
	if trimmed == "" {
		return fmt.Sprintf("upstream request failed with status %d", e.StatusCode)
	}
	return fmt.Sprintf("upstream request failed with status %d: %s", e.StatusCode, trimmed)
}

type searchValidationError struct {
	msg string
}

func (e *searchValidationError) Error() string {
	return e.msg
}

func newSearchValidationError(msg string) error {
	return &searchValidationError{msg: msg}
}

func (a *App) handleSearchConversations(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	payload, err := decodeConversationSearchRequest(req)
	if err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	bypassUpstream, err := shouldBypassUpstreamConversationSearch(payload)
	if err != nil {
		a.writeSearchError(w, "/query/conversations/search", err)
		return
	}
	if !bypassUpstream {
		if handled, err := a.tryProxySearchRequest(w, req, "/api/v1/conversations/search"); handled {
			if err != nil {
				a.writeSearchError(w, "/query/conversations/search", err)
			}
			return
		}
	}
	needsTempo, err := conversationSearchNeedsTempo(payload)
	if err != nil {
		a.writeSearchError(w, "/query/conversations/search", err)
		return
	}
	if needsTempo && !a.hasGrafanaDatasourceProxyTarget(a.tempoDatasourceUID) {
		http.Error(w, "grafana tempo datasource proxy is not configured", http.StatusServiceUnavailable)
		return
	}

	state, err := a.runConversationSearch(req, payload, nil)
	if err != nil {
		a.writeSearchError(w, "/query/conversations/search", err)
		return
	}
	writeJSONResponse(w, http.StatusOK, conversationSearchResponse{
		Conversations: state.Results,
		NextCursor:    state.NextCursor,
		HasMore:       state.HasMore,
	})
}

func (a *App) handleSearchConversationsStream(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming is not supported", http.StatusInternalServerError)
		return
	}

	payload, err := decodeConversationSearchRequest(req)
	if err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	bypassUpstream, err := shouldBypassUpstreamConversationSearch(payload)
	if err != nil {
		a.writeSearchError(w, "/query/conversations/search/stream", err)
		return
	}
	if !bypassUpstream {
		if handled, err := a.tryProxyStreamingSearchRequest(w, req, "/api/v1/conversations/search/stream"); handled {
			if err != nil {
				a.writeSearchError(w, "/query/conversations/search/stream", err)
			}
			return
		}
	}
	needsTempo, err := conversationSearchNeedsTempo(payload)
	if err != nil {
		a.writeSearchError(w, "/query/conversations/search/stream", err)
		return
	}
	if needsTempo && !a.hasGrafanaDatasourceProxyTarget(a.tempoDatasourceUID) {
		http.Error(w, "grafana tempo datasource proxy is not configured", http.StatusServiceUnavailable)
		return
	}
	started := false
	state, err := a.runConversationSearch(req, payload, func(batch []conversationSearchResult) error {
		if len(batch) == 0 {
			return nil
		}
		if !started {
			prepareConversationSearchStreamResponse(w)
			started = true
		}
		if err := json.NewEncoder(w).Encode(conversationSearchStreamResultsEvent{
			Type:          "results",
			Conversations: batch,
		}); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	})
	if err != nil {
		if !started {
			a.writeSearchError(w, "/query/conversations/search/stream", err)
			return
		}
		_ = json.NewEncoder(w).Encode(conversationSearchStreamErrorEvent{
			Type:    "error",
			Message: err.Error(),
		})
		flusher.Flush()
		return
	}

	if !started {
		prepareConversationSearchStreamResponse(w)
		started = true
	}
	_ = json.NewEncoder(w).Encode(conversationSearchStreamCompleteEvent{
		Type:       "complete",
		NextCursor: state.NextCursor,
		HasMore:    state.HasMore,
	})
	flusher.Flush()
}

func (a *App) handleConversationStats(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	payload, err := decodeConversationSearchRequest(req)
	if err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	bypassUpstream, err := shouldBypassUpstreamConversationSearch(payload)
	if err != nil {
		a.writeSearchError(w, "/query/conversations/stats", err)
		return
	}
	if !bypassUpstream {
		if handled, err := a.tryProxySearchRequest(w, req, "/api/v1/conversations/stats"); handled {
			if err != nil {
				a.writeSearchError(w, "/query/conversations/stats", err)
			}
			return
		}
	}
	needsTempo, err := conversationSearchNeedsTempo(payload)
	if err != nil {
		a.writeSearchError(w, "/query/conversations/stats", err)
		return
	}
	if needsTempo && !a.hasGrafanaDatasourceProxyTarget(a.tempoDatasourceUID) {
		http.Error(w, "grafana tempo datasource proxy is not configured", http.StatusServiceUnavailable)
		return
	}
	stats, err := a.searchConversationStats(req, payload)
	if err != nil {
		a.writeSearchError(w, "/query/conversations/stats", err)
		return
	}
	writeJSONResponse(w, http.StatusOK, stats)
}

func (a *App) handleSearchTags(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !a.hasGrafanaDatasourceProxyTarget(a.tempoDatasourceUID) {
		http.Error(w, "grafana tempo datasource proxy is not configured", http.StatusServiceUnavailable)
		return
	}

	from, to, err := parseSearchRange(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	start, end := searchcore.NormalizeTagDiscoveryRange(from, to, time.Now().UTC())
	traceQLQuery := strings.TrimSpace(req.URL.Query().Get("q"))

	spanTags, err := a.fetchTempoTags(req, "span", start, end, traceQLQuery)
	if err != nil {
		a.writeSearchError(w, "/query/search/tags", err)
		return
	}
	resourceTags, err := a.fetchTempoTags(req, "resource", start, end, traceQLQuery)
	if err != nil {
		a.writeSearchError(w, "/query/search/tags", err)
		return
	}

	tagMap := make(map[string]searchcore.SearchTag)
	for _, tag := range searchcore.WellKnownSearchTags() {
		tagMap[tag.Key] = tag
	}
	for _, tag := range spanTags {
		normalized := searchcore.NormalizeTempoTagKey("span", tag)
		if normalized == "" {
			continue
		}
		tagMap[normalized] = searchcore.SearchTag{Key: normalized, Scope: "span"}
	}
	for _, tag := range resourceTags {
		normalized := searchcore.NormalizeTempoTagKey("resource", tag)
		if normalized == "" {
			continue
		}
		tagMap[normalized] = searchcore.SearchTag{Key: normalized, Scope: "resource"}
	}

	tags := make([]searchcore.SearchTag, 0, len(tagMap))
	for _, tag := range tagMap {
		tags = append(tags, tag)
	}
	sort.Slice(tags, func(i, j int) bool {
		return tags[i].Key < tags[j].Key
	})

	writeJSONResponse(w, http.StatusOK, map[string]any{"tags": tags})
}

func (a *App) handleSearchTagValues(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !a.hasGrafanaDatasourceProxyTarget(a.tempoDatasourceUID) {
		http.Error(w, "grafana tempo datasource proxy is not configured", http.StatusServiceUnavailable)
		return
	}

	tag, ok := parseSearchTagValuesPath(req.URL.Path, req.URL.EscapedPath(), "/query/search/tag/")
	if !ok {
		http.Error(w, "invalid search tag path", http.StatusBadRequest)
		return
	}

	tempoTag, mysqlOnly, err := searchcore.ResolveTagKeyForTempo(tag)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if mysqlOnly {
		writeJSONResponse(w, http.StatusOK, map[string]any{"values": []string{}})
		return
	}

	from, to, err := parseSearchRange(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	start, end := searchcore.NormalizeTagDiscoveryRange(from, to, time.Now().UTC())
	traceQLQuery := strings.TrimSpace(req.URL.Query().Get("q"))

	values, err := a.fetchTempoTagValues(req, tempoTag, start, end, traceQLQuery)
	if err != nil {
		a.writeSearchError(w, "/query/search/tag/"+url.PathEscape(tag)+"/values", err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"values": values})
}

func (a *App) searchConversations(req *http.Request, payload conversationSearchRequest) (conversationSearchResponse, error) {
	var response conversationSearchResponse
	if err := a.doSigilJSONRequest(req, http.MethodPost, "/api/v1/conversations/search", nil, payload, &response); err == nil {
		return response, nil
	} else if !canFallbackProjectionSearchError(err) {
		return conversationSearchResponse{}, err
	}

	state, err := a.runConversationSearch(req, payload, nil)
	if err != nil {
		return conversationSearchResponse{}, err
	}
	return conversationSearchResponse{
		Conversations: state.Results,
		NextCursor:    state.NextCursor,
		HasMore:       state.HasMore,
	}, nil
}

func (a *App) searchConversationStats(req *http.Request, payload conversationSearchRequest) (conversationStatsResponse, error) {
	_, to, err := normalizeConversationSearchTimeRange(payload.TimeRange)
	if err != nil {
		return conversationStatsResponse{}, err
	}
	parsedFilters, err := searchcore.ParseFilterExpression(payload.Filters)
	if err != nil {
		return conversationStatsResponse{}, newSearchValidationError(err.Error())
	}
	if err := searchcore.ValidateMySQLFilterTerms(parsedFilters.MySQLTerms); err != nil {
		return conversationStatsResponse{}, newSearchValidationError(err.Error())
	}

	stats := conversationStatsResponse{}
	totalCalls := 0
	badRatedConversations := 0
	request := payload
	request.Select = []string{
		conversationSearchInputTokensSelectKey,
		conversationSearchOutputTokensSelectKey,
		conversationSearchCacheReadTokensSelectKey,
		conversationSearchCacheWriteTokensSelectKey,
		conversationSearchReasoningTokensSelectKey,
	}
	request.PageSize = searchcore.MaxConversationSearchPageSize
	request.Cursor = ""
	pageIndex := 0

	for {
		state, err := a.runConversationSearch(req, request, nil)
		if err != nil {
			return conversationStatsResponse{}, err
		}
		pageCalls, pageBadRated := accumulateConversationStats(&stats, state.Results, to)
		totalCalls += pageCalls
		badRatedConversations += pageBadRated
		if !state.HasMore || strings.TrimSpace(state.NextCursor) == "" {
			break
		}
		request.Cursor = state.NextCursor
		pageIndex++
		if pageIndex >= maxStatsSearchPages {
			break
		}
	}

	if stats.TotalConversations > 0 {
		stats.AvgCallsPerConversation = float64(totalCalls) / float64(stats.TotalConversations)
	}
	if stats.RatedConversations > 0 {
		stats.BadRatedPct = (float64(badRatedConversations) / float64(stats.RatedConversations)) * 100
	}
	return stats, nil
}

func accumulateConversationStats(
	stats *conversationStatsResponse,
	conversations []conversationSearchResult,
	windowEnd time.Time,
) (int, int) {
	if stats == nil || len(conversations) == 0 {
		return 0, 0
	}

	week := 7 * 24 * time.Hour
	totalCalls := 0
	badRatedConversations := 0
	for _, conversation := range conversations {
		stats.TotalConversations++
		totalCalls += conversation.GenerationCount
		stats.TotalTokens += conversationSelectedNumber(conversation.Selected, conversationSearchInputTokensSelectKey)
		stats.TotalTokens += conversationSelectedNumber(conversation.Selected, conversationSearchOutputTokensSelectKey)
		stats.TotalTokens += conversationSelectedNumber(conversation.Selected, conversationSearchCacheReadTokensSelectKey)
		stats.TotalTokens += conversationSelectedNumber(conversation.Selected, conversationSearchCacheWriteTokensSelectKey)
		stats.TotalTokens += conversationSelectedNumber(conversation.Selected, conversationSearchReasoningTokensSelectKey)

		lastActivity := conversation.LastGenerationAt.UTC()
		if !lastActivity.IsZero() {
			age := windowEnd.Sub(lastActivity)
			if age >= 0 && age <= week {
				stats.ActiveLast7d++
			}
		}
		if conversation.RatingSummary != nil && conversation.RatingSummary.TotalCount > 0 {
			stats.RatedConversations++
			if conversation.RatingSummary.HasBadRating {
				badRatedConversations++
			}
		}
	}
	return totalCalls, badRatedConversations
}

func conversationSelectedNumber(selected map[string]any, key string) float64 {
	if len(selected) == 0 {
		return 0
	}
	value, ok := selected[key]
	if !ok {
		return 0
	}
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		parsed, err := typed.Float64()
		if err == nil {
			return parsed
		}
	}
	return 0
}

func (a *App) runConversationSearch(
	req *http.Request,
	payload conversationSearchRequest,
	emit func([]conversationSearchResult) error,
) (conversationSearchState, error) {
	from, to, err := normalizeConversationSearchTimeRange(payload.TimeRange)
	if err != nil {
		return conversationSearchState{}, err
	}

	parsedFilters, err := searchcore.ParseFilterExpression(payload.Filters)
	if err != nil {
		return conversationSearchState{}, newSearchValidationError(err.Error())
	}
	if err := searchcore.ValidateMySQLFilterTerms(parsedFilters.MySQLTerms); err != nil {
		return conversationSearchState{}, newSearchValidationError(err.Error())
	}

	selectFields, err := searchcore.NormalizeSelectFields(payload.Select)
	if err != nil {
		return conversationSearchState{}, newSearchValidationError(err.Error())
	}

	pageSize := searchcore.NormalizeConversationSearchPageSize(payload.PageSize)
	overfetchLimit := pageSize * searchcore.DefaultTempoOverfetchMultiplier
	if emit != nil {
		streamOverfetchLimit := pageSize * conversationSearchStreamOverfetchMultiplier
		if streamOverfetchLimit > overfetchLimit {
			overfetchLimit = streamOverfetchLimit
		}
	}
	if overfetchLimit < pageSize {
		overfetchLimit = pageSize
	}

	filterHash := searchcore.BuildConversationSearchFilterHash(parsedFilters, selectFields, from, to)
	cursor, err := searchcore.DecodeConversationSearchCursor(payload.Cursor)
	if err != nil {
		return conversationSearchState{}, newSearchValidationError("invalid cursor")
	}
	if strings.TrimSpace(payload.Cursor) != "" && cursor.FilterHash != filterHash {
		return conversationSearchState{}, newSearchValidationError("cursor no longer matches current filters")
	}

	traceQL, err := searchcore.BuildTraceQL(parsedFilters, selectFields)
	if err != nil {
		return conversationSearchState{}, newSearchValidationError(err.Error())
	}

	searchEndNanos := to.UnixNano()
	if cursor.EndNanos > 0 && cursor.EndNanos < searchEndNanos {
		searchEndNanos = cursor.EndNanos
	}
	if searchEndNanos <= from.UnixNano() {
		return conversationSearchState{Results: []conversationSearchResult{}, HasMore: false}, nil
	}

	alreadyReturned := make(map[string]struct{}, len(cursor.ReturnedConversations))
	for _, conversationID := range cursor.ReturnedConversations {
		alreadyReturned[conversationID] = struct{}{}
	}
	currentPageIDs := make(map[string]struct{}, pageSize)

	results := make([]conversationSearchResult, 0, pageSize)
	hasMore := false
	terminatedByIterationLimit := searchcore.DefaultTempoSearchMaxIterations > 0

	for iteration := 0; iteration < searchcore.DefaultTempoSearchMaxIterations; iteration++ {
		windowEnd := time.Unix(0, searchEndNanos).UTC()
		if !from.Before(windowEnd) {
			terminatedByIterationLimit = false
			break
		}

		tempoResponse, err := a.searchTempo(req, traceQL, overfetchLimit, from, windowEnd)
		if err != nil {
			return conversationSearchState{}, err
		}
		if len(tempoResponse.Traces) == 0 {
			terminatedByIterationLimit = false
			break
		}

		grouped := searchcore.GroupTempoSearchResponse(tempoResponse, selectFields)
		orderedConversationIDs := searchcore.OrderTempoConversationIDs(grouped.Conversations)

		foundAdditionalConversation := false
		for start := 0; start < len(orderedConversationIDs); start += conversationSearchMetadataChunkSize {
			end := start + conversationSearchMetadataChunkSize
			if end > len(orderedConversationIDs) {
				end = len(orderedConversationIDs)
			}
			chunkIDs := orderedConversationIDs[start:end]
			metadataByConversation, err := a.fetchConversationBatchMetadata(req, chunkIDs)
			if err != nil {
				return conversationSearchState{}, err
			}

			batch := make([]conversationSearchResult, 0, min(pageSize-len(results), len(chunkIDs)))
			for _, conversationID := range chunkIDs {
				if _, seen := alreadyReturned[conversationID]; seen {
					continue
				}
				if _, seen := currentPageIDs[conversationID]; seen {
					continue
				}

				conversationMetadata, ok := metadataByConversation[conversationID]
				if !ok {
					continue
				}
				if !searchcore.MatchesGenerationCountFilters(conversationMetadata.GenerationCount, parsedFilters.MySQLTerms) {
					continue
				}

				if len(results) >= pageSize {
					foundAdditionalConversation = true
					break
				}

				aggregate := grouped.Conversations[conversationID]
				result := conversationSearchResult{
					ConversationID:    conversationID,
					ConversationTitle: strings.TrimSpace(conversationMetadata.ConversationTitle),
					UserID:            aggregate.UserID,
					GenerationCount:   conversationMetadata.GenerationCount,
					FirstGenerationAt: conversationMetadata.FirstGenerationAt.UTC(),
					LastGenerationAt:  conversationMetadata.LastGenerationAt.UTC(),
					Models:            searchcore.SortedKeysFromSet(aggregate.Models),
					Agents:            searchcore.SortedKeysFromSet(aggregate.Agents),
					ErrorCount:        aggregate.ErrorCount,
					HasErrors:         aggregate.ErrorCount > 0,
					TraceIDs:          searchcore.SortedKeysFromSet(aggregate.TraceIDs),
					AnnotationCount:   conversationMetadata.AnnotationCount,
					Selected:          searchcore.BuildSelectedResultMap(aggregate.Selected),
				}
				if conversationMetadata.RatingSummary != nil {
					copied := *conversationMetadata.RatingSummary
					result.RatingSummary = &copied
				}
				if conversationMetadata.EvalSummary != nil {
					copied := *conversationMetadata.EvalSummary
					result.EvalSummary = &copied
				}
				results = append(results, result)
				batch = append(batch, result)
				currentPageIDs[conversationID] = struct{}{}
			}

			if len(batch) > 0 && emit != nil {
				if err := emit(batch); err != nil {
					return conversationSearchState{}, err
				}
			}
			if foundAdditionalConversation {
				break
			}
		}

		if foundAdditionalConversation {
			hasMore = true
			terminatedByIterationLimit = false
			break
		}
		if grouped.EarliestTraceStartNanos <= 0 || grouped.EarliestTraceStartNanos <= from.UnixNano() {
			terminatedByIterationLimit = false
			break
		}
		if len(tempoResponse.Traces) < overfetchLimit {
			terminatedByIterationLimit = false
			break
		}

		searchEndNanos = grouped.EarliestTraceStartNanos - 1
	}

	if terminatedByIterationLimit && !hasMore && searchEndNanos > from.UnixNano() {
		hasMore = true
	}

	nextCursor := ""
	if hasMore {
		returnedConversations := make([]string, 0, len(alreadyReturned)+len(results))
		for conversationID := range alreadyReturned {
			returnedConversations = append(returnedConversations, conversationID)
		}
		for _, result := range results {
			returnedConversations = append(returnedConversations, result.ConversationID)
		}
		nextCursor, err = searchcore.EncodeConversationSearchCursor(searchcore.ConversationSearchCursor{
			EndNanos:              searchEndNanos,
			ReturnedConversations: returnedConversations,
			FilterHash:            filterHash,
		})
		if err != nil {
			return conversationSearchState{}, err
		}
	}

	return conversationSearchState{
		Results:    results,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

func conversationSearchNeedsTempo(payload conversationSearchRequest) (bool, error) {
	parsedFilters, err := searchcore.ParseFilterExpression(payload.Filters)
	if err != nil {
		return false, newSearchValidationError(err.Error())
	}
	if err := searchcore.ValidateMySQLFilterTerms(parsedFilters.MySQLTerms); err != nil {
		return false, newSearchValidationError(err.Error())
	}
	if _, err := searchcore.NormalizeSelectFields(payload.Select); err != nil {
		return false, newSearchValidationError(err.Error())
	}
	return true, nil
}

func shouldBypassUpstreamConversationSearch(payload conversationSearchRequest) (bool, error) {
	parsedFilters, err := searchcore.ParseFilterExpression(payload.Filters)
	if err != nil {
		return false, newSearchValidationError(err.Error())
	}
	for _, term := range parsedFilters.TempoTerms {
		key := strings.TrimSpace(term.RawKey)
		// Tool-scoped drilldowns already work through the plugin's Tempo +
		// batch-metadata path. Bypassing upstream here avoids rollout skew where
		// the app starts emitting tool filters before the Sigil search endpoint on
		// the target environment can serve them reliably.
		if key == "tool.name" {
			return true, nil
		}
		if strings.HasPrefix(key, "span.") || strings.HasPrefix(key, "resource.") {
			return true, nil
		}
	}
	return false, nil
}

func canFallbackProjectionSearchError(err error) bool {
	upstreamErr := (*upstreamHTTPError)(nil)
	if !errors.As(err, &upstreamErr) {
		return false
	}
	switch upstreamErr.StatusCode {
	case http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusNotImplemented:
		return true
	default:
		return false
	}
}

func decodeConversationSearchRequest(req *http.Request) (conversationSearchRequest, error) {
	var payload conversationSearchRequest
	if req.Body == nil {
		return payload, nil
	}

	body, err := io.ReadAll(req.Body)
	if err != nil {
		return conversationSearchRequest{}, err
	}
	req.Body = io.NopCloser(bytes.NewReader(body))

	if len(body) > 0 {
		if err := json.Unmarshal(body, &payload); err != nil {
			return conversationSearchRequest{}, err
		}
	}
	return payload, nil
}

func prepareConversationSearchStreamResponse(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
}

func normalizeConversationSearchTimeRange(timeRange conversationSearchTimeRange) (time.Time, time.Time, error) {
	from := timeRange.From.UTC()
	to := timeRange.To.UTC()
	if from.IsZero() || to.IsZero() {
		return time.Time{}, time.Time{}, newSearchValidationError("time_range.from and time_range.to are required")
	}
	if !from.Before(to) {
		return time.Time{}, time.Time{}, newSearchValidationError("time_range.from must be before time_range.to")
	}
	return from, to, nil
}

func (a *App) searchTempo(
	req *http.Request,
	traceQL string,
	limit int,
	from time.Time,
	to time.Time,
) (*searchcore.TempoSearchResponse, error) {
	query := url.Values{}
	query.Set("q", traceQL)
	query.Set("limit", strconv.Itoa(limit))
	query.Set("start", strconv.FormatInt(from.UTC().Unix(), 10))
	query.Set("end", strconv.FormatInt(to.UTC().Unix(), 10))
	query.Set("spss", strconv.Itoa(searchcore.DefaultTempoSearchSpansPerSpanSet))

	var response searchcore.TempoSearchResponse
	if err := a.doGrafanaJSONRequest(
		req,
		http.MethodGet,
		fmt.Sprintf("/api/datasources/proxy/uid/%s/api/search", a.tempoDatasourceUID),
		query,
		nil,
		&response,
	); err != nil {
		return nil, err
	}
	if response.Traces == nil {
		response.Traces = []searchcore.TempoTrace{}
	}
	return &response, nil
}

func (a *App) fetchTempoTags(req *http.Request, scope string, from, to time.Time, traceQLQuery string) ([]string, error) {
	query := url.Values{}
	if trimmedScope := strings.TrimSpace(scope); trimmedScope != "" {
		query.Set("scope", trimmedScope)
	}
	query.Set("start", strconv.FormatInt(from.UTC().Unix(), 10))
	query.Set("end", strconv.FormatInt(to.UTC().Unix(), 10))
	if trimmedQuery := strings.TrimSpace(traceQLQuery); trimmedQuery != "" {
		query.Set("q", trimmedQuery)
	}

	body, err := a.doGrafanaRequest(
		req,
		http.MethodGet,
		fmt.Sprintf("/api/datasources/proxy/uid/%s/api/v2/search/tags", a.tempoDatasourceUID),
		query,
		nil,
	)
	if err != nil {
		return nil, err
	}
	return searchcore.ExtractStringSlice(body, "tagNames", "tags", "scopes")
}

func (a *App) fetchTempoTagValues(req *http.Request, tag string, from, to time.Time, traceQLQuery string) ([]string, error) {
	query := url.Values{}
	query.Set("start", strconv.FormatInt(from.UTC().Unix(), 10))
	query.Set("end", strconv.FormatInt(to.UTC().Unix(), 10))
	if trimmedQuery := strings.TrimSpace(traceQLQuery); trimmedQuery != "" {
		query.Set("q", trimmedQuery)
	}

	body, err := a.doGrafanaRequest(
		req,
		http.MethodGet,
		fmt.Sprintf("/api/datasources/proxy/uid/%s/api/v2/search/tag/%s/values", a.tempoDatasourceUID, url.PathEscape(strings.TrimSpace(tag))),
		query,
		nil,
	)
	if err != nil {
		return nil, err
	}
	return searchcore.ExtractStringSlice(body, "values", "tagValues")
}

func (a *App) fetchConversationBatchMetadata(req *http.Request, conversationIDs []string) (map[string]conversationBatchMetadata, error) {
	normalizedIDs := searchcore.DedupeAndSortStrings(conversationIDs)
	if len(normalizedIDs) == 0 {
		return map[string]conversationBatchMetadata{}, nil
	}

	var response conversationBatchMetadataResponse
	if err := a.doSigilJSONRequest(req, http.MethodPost, "/api/v1/conversations:batch-metadata", nil, conversationBatchMetadataRequest{
		ConversationIDs: normalizedIDs,
	}, &response); err != nil {
		return nil, err
	}

	out := make(map[string]conversationBatchMetadata, len(response.Items))
	for _, item := range response.Items {
		conversationID := strings.TrimSpace(item.ConversationID)
		if conversationID == "" {
			continue
		}
		out[conversationID] = item
	}
	return out, nil
}

func (a *App) doSigilJSONRequest(
	req *http.Request,
	method string,
	path string,
	query url.Values,
	requestBody any,
	responseBody any,
) error {
	body, err := encodeJSONBody(requestBody)
	if err != nil {
		return err
	}
	payload, err := a.doSigilRequest(req, method, path, query, body)
	if err != nil {
		return err
	}
	if responseBody == nil {
		return nil
	}
	if err := json.Unmarshal(payload, responseBody); err != nil {
		return fmt.Errorf("decode sigil response: %w", err)
	}
	return nil
}

func (a *App) tryProxySearchRequest(w http.ResponseWriter, req *http.Request, path string) (bool, error) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		return true, fmt.Errorf("read request body: %w", err)
	}
	req.Body = io.NopCloser(bytes.NewReader(body))

	responseBody, err := a.doSigilRequest(req, req.Method, path, nil, body)
	if err != nil {
		if canFallbackProjectionSearchError(err) {
			req.Body = io.NopCloser(bytes.NewReader(body))
			return false, nil
		}
		return true, err
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(responseBody)
	return true, nil
}

func (a *App) tryProxyStreamingSearchRequest(w http.ResponseWriter, req *http.Request, path string) (bool, error) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		return true, fmt.Errorf("read request body: %w", err)
	}
	req.Body = io.NopCloser(bytes.NewReader(body))

	ctx, span := pluginProxyTracer.Start(
		req.Context(),
		"sigil.plugin.proxy.sigil.stream",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("http.request.method", req.Method),
			attribute.String("url.path", path),
		),
	)
	defer span.End()

	upstream := strings.TrimRight(a.apiURL, "/") + path
	proxyReq, err := http.NewRequestWithContext(ctx, req.Method, upstream, bytes.NewReader(body))
	if err != nil {
		return true, fmt.Errorf("build request: %w", err)
	}
	proxyReq.Header = req.Header.Clone()
	proxyReq.Header.Set("Content-Type", "application/json")
	if a.apiAuthToken != "" {
		proxyReq.SetBasicAuth(a.tenantID, a.apiAuthToken)
	}
	injectTenantHeaders(proxyReq, a.tenantID)
	injectOperatorIdentityHeaders(proxyReq, req.Method, path)
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(proxyReq.Header))

	resp, err := a.client.Do(proxyReq)
	if err != nil {
		return true, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode >= http.StatusBadRequest {
		payload, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return true, readErr
		}
		err = &upstreamHTTPError{StatusCode: resp.StatusCode, Body: payload}
		if canFallbackProjectionSearchError(err) {
			req.Body = io.NopCloser(bytes.NewReader(body))
			return false, nil
		}
		return true, err
	}

	copyUpstreamResponseHeaders(w.Header(), resp.Header)
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/x-ndjson")
	}
	w.WriteHeader(resp.StatusCode)
	flusher, ok := w.(http.Flusher)
	if !ok {
		_, copyErr := io.Copy(w, resp.Body)
		return true, copyErr
	}

	buffer := make([]byte, 32*1024)
	for {
		n, readErr := resp.Body.Read(buffer)
		if n > 0 {
			if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
				return true, writeErr
			}
			flusher.Flush()
		}
		if readErr == nil {
			continue
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		return true, readErr
	}
	return true, nil
}

func (a *App) doGrafanaJSONRequest(
	req *http.Request,
	method string,
	path string,
	query url.Values,
	requestBody any,
	responseBody any,
) error {
	body, err := encodeJSONBody(requestBody)
	if err != nil {
		return err
	}
	payload, err := a.doGrafanaRequest(req, method, path, query, body)
	if err != nil {
		return err
	}
	if responseBody == nil {
		return nil
	}
	if err := json.Unmarshal(payload, responseBody); err != nil {
		return fmt.Errorf("decode grafana response: %w", err)
	}
	return nil
}

func encodeJSONBody(value any) ([]byte, error) {
	if value == nil {
		return nil, nil
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode request body: %w", err)
	}
	return payload, nil
}

func (a *App) doSigilRequest(
	req *http.Request,
	method string,
	path string,
	query url.Values,
	body []byte,
) ([]byte, error) {
	upstream := strings.TrimRight(a.apiURL, "/") + path
	if encodedQuery := query.Encode(); encodedQuery != "" {
		upstream += "?" + encodedQuery
	}

	backend.Logger.Debug("sigil proxy request",
		"method", method,
		"path", path,
		"upstream", upstream,
		"tenantID", a.tenantID,
		"hasAuthToken", a.apiAuthToken != "",
		"hasBody", body != nil,
	)

	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	proxyReq, err := http.NewRequestWithContext(req.Context(), method, upstream, bodyReader)
	if err != nil {
		backend.Logger.Error("sigil proxy request build failed", "path", path, "error", err)
		return nil, fmt.Errorf("build sigil request: %w", err)
	}
	proxyReq.Header = req.Header.Clone()
	proxyReq.Header.Del("Accept-Encoding")
	if body != nil {
		proxyReq.Header.Set("Content-Type", "application/json")
	}
	if a.apiAuthToken != "" {
		proxyReq.SetBasicAuth(a.tenantID, a.apiAuthToken)
	}
	injectTenantHeaders(proxyReq, a.tenantID)

	payload, err := a.executeUpstreamRequest(proxyReq)
	if err != nil {
		backend.Logger.Warn("sigil proxy request failed",
			"method", method,
			"path", path,
			"upstream", upstream,
			"error", err,
		)
		return nil, err
	}
	return payload, nil
}

func (a *App) doGrafanaRequest(
	req *http.Request,
	method string,
	path string,
	query url.Values,
	body []byte,
) ([]byte, error) {
	ctx, span := pluginProxyTracer.Start(
		req.Context(),
		"sigil.plugin.query.grafana",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("http.request.method", method),
			attribute.String("url.path", path),
		),
	)
	defer span.End()

	upstream := strings.TrimRight(a.grafanaAppURL, "/") + path
	if encodedQuery := query.Encode(); encodedQuery != "" {
		upstream += "?" + encodedQuery
	}

	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	proxyReq, err := http.NewRequestWithContext(ctx, method, upstream, bodyReader)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "build grafana request")
		return nil, fmt.Errorf("build grafana request: %w", err)
	}
	proxyReq.Header = req.Header.Clone()
	proxyReq.Header.Del("Accept-Encoding")
	if body != nil {
		proxyReq.Header.Set("Content-Type", "application/json")
	}
	if token := strings.TrimSpace(a.grafanaServiceAccountToken); token != "" {
		proxyReq.Header.Set("Authorization", "Bearer "+token)
	}
	injectTenantHeaders(proxyReq, a.tenantID)
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(proxyReq.Header))

	payload, err := a.executeUpstreamRequest(proxyReq)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "upstream request failed")
		if upstreamErr := (*upstreamHTTPError)(nil); errors.As(err, &upstreamErr) {
			span.SetAttributes(attribute.Int("http.response.status_code", upstreamErr.StatusCode))
		}
		return nil, err
	}
	return payload, nil
}

func (a *App) executeUpstreamRequest(proxyReq *http.Request) ([]byte, error) {
	resp, err := a.client.Do(proxyReq)
	if err != nil {
		return nil, fmt.Errorf("upstream unavailable: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read upstream response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &upstreamHTTPError{
			StatusCode: resp.StatusCode,
			Body:       payload,
		}
	}
	return payload, nil
}

func (a *App) writeSearchError(w http.ResponseWriter, endpoint string, err error) {
	if validationErr := (*searchValidationError)(nil); errors.As(err, &validationErr) {
		http.Error(w, validationErr.Error(), http.StatusBadRequest)
		return
	}
	if upstreamErr := (*upstreamHTTPError)(nil); errors.As(err, &upstreamErr) {
		trimmed := bytes.TrimSpace(decompressIfGzipped(upstreamErr.Body))
		if json.Valid(trimmed) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(upstreamErr.StatusCode)
			_, _ = w.Write(trimmed)
			return
		}
		if len(trimmed) > 0 {
			http.Error(w, string(trimmed), upstreamErr.StatusCode)
			return
		}
		http.Error(w, http.StatusText(upstreamErr.StatusCode), upstreamErr.StatusCode)
		return
	}

	writeStub(w, http.StatusBadGateway, endpoint, err.Error())
}

func decompressIfGzipped(payload []byte) []byte {
	if len(payload) < 2 || payload[0] != 0x1f || payload[1] != 0x8b {
		return payload
	}

	reader, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return payload
	}
	defer func() {
		_ = reader.Close()
	}()

	decompressed, err := io.ReadAll(reader)
	if err != nil {
		return payload
	}
	return decompressed
}

func parseSearchRange(req *http.Request) (time.Time, time.Time, error) {
	parseUnixSeconds := func(raw string) (time.Time, error) {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			return time.Time{}, nil
		}
		seconds, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil {
			return time.Time{}, errors.New("invalid time range")
		}
		return time.Unix(seconds, 0).UTC(), nil
	}

	start, err := parseUnixSeconds(req.URL.Query().Get("start"))
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	end, err := parseUnixSeconds(req.URL.Query().Get("end"))
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return start, end, nil
}

func writeJSONResponse(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
