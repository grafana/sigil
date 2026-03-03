package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

type stubResponse struct {
	Status   string `json:"status"`
	Source   string `json:"source"`
	Endpoint string `json:"endpoint"`
	Error    string `json:"error,omitempty"`
}

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

	authzClient, err := a.GetAuthZClient(ctx)
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

func requiredPermissionAction(method string, path string) (string, bool) {
	switch {
	case method == http.MethodGet && path == "/query/conversations":
		return PermissionDataRead, true
	case method == http.MethodPost && path == "/query/conversations/search":
		return PermissionDataRead, true
	case strings.HasPrefix(path, "/query/conversations/"):
		return permissionForConversationRoute(method, path)
	case method == http.MethodGet && strings.HasPrefix(path, "/query/generations/"):
		return PermissionDataRead, true
	case method == http.MethodGet && path == "/query/search/tags":
		return PermissionDataRead, true
	case method == http.MethodGet && strings.HasPrefix(path, "/query/search/tag/") && strings.HasSuffix(path, "/values"):
		return PermissionDataRead, true
	case method == http.MethodGet && path == "/query/settings":
		return PermissionDataRead, true
	case method == http.MethodPut && path == "/query/settings/datasources":
		return PermissionSettingsWrite, true
	case strings.HasPrefix(path, "/query/proxy/prometheus/"):
		return PermissionDataRead, true
	case strings.HasPrefix(path, "/query/proxy/tempo/"):
		return PermissionDataRead, true
	case method == http.MethodGet && path == "/query/model-cards":
		return PermissionDataRead, true
	case method == http.MethodGet && path == "/query/model-cards/lookup":
		return PermissionDataRead, true
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
		return PermissionDataRead, true
	}
	if len(parts) != 2 {
		return "", false
	}

	switch parts[1] {
	case "ratings", "annotations":
		if method == http.MethodGet {
			return PermissionDataRead, true
		}
		if method == http.MethodPost {
			return PermissionFeedbackWrite, true
		}
	}

	return "", false
}

func (a *App) handleListConversations(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/conversations", http.MethodGet)
}

func (a *App) handleSearchConversations(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/conversations/search", http.MethodPost)
}

func (a *App) handleConversationRoutes(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/query/conversations/")
	if id == "" || strings.Contains(id, "/") {
		parts := strings.Split(id, "/")
		if len(parts) != 2 || parts[0] == "" || (parts[1] != "ratings" && parts[1] != "annotations") {
			http.Error(w, "invalid conversation path", http.StatusBadRequest)
			return
		}
		id = parts[0]
		child := parts[1]
		path := fmt.Sprintf("/api/v1/conversations/%s/%s", id, child)
		switch req.Method {
		case http.MethodGet, http.MethodPost:
			a.handleProxy(w, req, path, req.Method)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.handleProxy(w, req, fmt.Sprintf("/api/v1/conversations/%s", id), http.MethodGet)
}

func (a *App) handleGenerationRoutes(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/query/generations/")
	if id == "" || strings.Contains(id, "/") {
		http.Error(w, "invalid generation path", http.StatusBadRequest)
		return
	}
	a.handleProxy(w, req, fmt.Sprintf("/api/v1/generations/%s", id), http.MethodGet)
}

func (a *App) handleSearchTags(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/search/tags", http.MethodGet)
}

func (a *App) handleSearchTagValues(w http.ResponseWriter, req *http.Request) {
	tag, ok := parseSearchTagValuesPath(req.URL.Path, req.URL.EscapedPath(), "/query/search/tag/")
	if !ok {
		http.Error(w, "invalid search tag path", http.StatusBadRequest)
		return
	}
	a.handleProxy(w, req, fmt.Sprintf("/api/v1/search/tag/%s/values", url.PathEscape(tag)), http.MethodGet)
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

func (a *App) handleProxy(w http.ResponseWriter, req *http.Request, path string, method string) {
	if req.Method != method {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	upstream := strings.TrimRight(a.apiURL, "/") + path
	if req.URL.RawQuery != "" {
		upstream += "?" + req.URL.RawQuery
	}

	var body io.Reader
	if req.Body != nil {
		body = req.Body
	}
	proxyReq, err := http.NewRequestWithContext(req.Context(), method, upstream, body)
	if err != nil {
		writeStub(w, http.StatusInternalServerError, path, fmt.Sprintf("build request: %v", err))
		return
	}
	// Intentionally forward Grafana identity headers (including X-Grafana-Id)
	// to Sigil in this deployment model; RBAC checks are performed in-plugin.
	proxyReq.Header = req.Header.Clone()
	// Remove Accept-Encoding so the upstream always returns uncompressed
	// responses. Without this the upstream may gzip the body, but
	// our proxy does not forward Content-Encoding, causing garbled output.
	proxyReq.Header.Del("Accept-Encoding")
	if a.apiAuthToken != "" {
		proxyReq.SetBasicAuth(a.tenantID, a.apiAuthToken)
	}
	injectTenantHeaders(proxyReq, a.tenantID)
	injectOperatorIdentityHeaders(proxyReq, method, path)

	resp, err := a.client.Do(proxyReq)
	if err != nil {
		writeStub(w, http.StatusBadGateway, path, fmt.Sprintf("upstream unavailable: %v", err))
		return
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			// Best-effort close after response handling; no recovery path here.
			_ = closeErr
		}
	}()

	// Forward the upstream Content-Type when available; fall back to JSON.
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/json"
	}
	w.Header().Set("Content-Type", ct)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (a *App) handleGrafanaProxy(w http.ResponseWriter, req *http.Request, path string, method string) {
	if req.Method != method {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	upstream := strings.TrimRight(a.grafanaAppURL, "/") + path
	if req.URL.RawQuery != "" {
		upstream += "?" + req.URL.RawQuery
	}

	var body io.Reader
	if req.Body != nil {
		body = req.Body
	}
	proxyReq, err := http.NewRequestWithContext(req.Context(), method, upstream, body)
	if err != nil {
		writeStub(w, http.StatusInternalServerError, path, fmt.Sprintf("build request: %v", err))
		return
	}

	// Intentionally forward Grafana identity headers (including X-Grafana-Id)
	// to datasource-proxy targets; RBAC checks are performed in-plugin.
	proxyReq.Header = req.Header.Clone()
	proxyReq.Header.Del("Accept-Encoding")
	if token := strings.TrimSpace(a.grafanaServiceAccountToken); token != "" {
		proxyReq.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := a.client.Do(proxyReq)
	if err != nil {
		writeStub(w, http.StatusBadGateway, path, fmt.Sprintf("upstream unavailable: %v", err))
		return
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			_ = closeErr
		}
	}()

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/json"
	}
	w.Header().Set("Content-Type", ct)
	w.WriteHeader(resp.StatusCode)
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
	id := strings.TrimPrefix(req.URL.Path, "/eval/rules/")
	if id == "" || strings.Contains(id, "/") {
		http.Error(w, "invalid rule path", http.StatusBadRequest)
		return
	}
	path := fmt.Sprintf("/api/v1/eval/rules/%s", id)
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

func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/query/conversations/search", a.withAuthorization(a.handleSearchConversations))
	mux.HandleFunc("/query/conversations", a.withAuthorization(a.handleListConversations))
	mux.HandleFunc("/query/conversations/", a.withAuthorization(a.handleConversationRoutes))
	mux.HandleFunc("/query/generations/", a.withAuthorization(a.handleGenerationRoutes))
	mux.HandleFunc("/query/search/tags", a.withAuthorization(a.handleSearchTags))
	mux.HandleFunc("/query/search/tag/", a.withAuthorization(a.handleSearchTagValues))
	mux.HandleFunc("/query/settings", a.withAuthorization(a.handleSettingsRoutes))
	mux.HandleFunc("/query/settings/datasources", a.withAuthorization(a.handleSettingsRoutes))
	mux.HandleFunc("/query/proxy/prometheus/", a.withAuthorization(a.handlePrometheusProxyRoutes))
	mux.HandleFunc("/query/proxy/tempo/", a.withAuthorization(a.handleTempoProxyRoutes))
	mux.HandleFunc("/query/model-cards", a.withAuthorization(a.handleListModelCards))
	mux.HandleFunc("/query/model-cards/lookup", a.withAuthorization(a.handleLookupModelCard))

	mux.HandleFunc("/eval/evaluators", a.handleEvalEvaluators)
	mux.HandleFunc("/eval/evaluators/", a.handleEvalEvaluatorByID)
	mux.HandleFunc("/eval/predefined/evaluators", a.handleEvalPredefinedEvaluators)
	mux.HandleFunc("/eval/predefined/evaluators/", a.handleEvalPredefinedFork)
	mux.HandleFunc("/eval/rules:preview", a.handleEvalRulesPreview)
	mux.HandleFunc("/eval/rules", a.handleEvalRules)
	mux.HandleFunc("/eval/rules/", a.handleEvalRuleByID)
	mux.HandleFunc("/eval/judge/providers", a.handleEvalJudgeProviders)
	mux.HandleFunc("/eval/judge/models", a.handleEvalJudgeModels)
}
