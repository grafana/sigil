package plugin

import (
	"encoding/json"
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

func (a *App) handlePrometheusProxyRoutes(w http.ResponseWriter, req *http.Request) {
	a.handleDownstreamProxy(w, req, "/query/proxy/prometheus/", "/api/v1/proxy/prometheus")
}

func (a *App) handleTempoProxyRoutes(w http.ResponseWriter, req *http.Request) {
	a.handleDownstreamProxy(w, req, "/query/proxy/tempo/", "/api/v1/proxy/tempo")
}

func (a *App) handleDownstreamProxy(w http.ResponseWriter, req *http.Request, routePrefix string, upstreamPrefix string) {
	downstreamPath, ok := downstreamProxyPath(req.URL.Path, routePrefix)
	if !ok {
		http.Error(w, "invalid proxy path", http.StatusBadRequest)
		return
	}
	a.handleProxy(w, req, upstreamPrefix+downstreamPath, req.Method)
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
	proxyReq.Header = req.Header.Clone()
	// Remove Accept-Encoding so the upstream always returns uncompressed
	// responses. Without this the upstream may gzip the body, but
	// our proxy does not forward Content-Encoding, causing garbled output.
	proxyReq.Header.Del("Accept-Encoding")
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

func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/query/conversations/search", a.handleSearchConversations)
	mux.HandleFunc("/query/conversations", a.handleListConversations)
	mux.HandleFunc("/query/conversations/", a.handleConversationRoutes)
	mux.HandleFunc("/query/generations/", a.handleGenerationRoutes)
	mux.HandleFunc("/query/search/tags", a.handleSearchTags)
	mux.HandleFunc("/query/search/tag/", a.handleSearchTagValues)
	mux.HandleFunc("/query/proxy/prometheus/", a.handlePrometheusProxyRoutes)
	mux.HandleFunc("/query/proxy/tempo/", a.handleTempoProxyRoutes)
	mux.HandleFunc("/query/model-cards", a.handleListModelCards)
	mux.HandleFunc("/query/model-cards/lookup", a.handleLookupModelCard)
}
