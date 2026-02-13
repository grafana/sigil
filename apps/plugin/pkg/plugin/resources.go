package plugin

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type stubResponse struct {
	Status   string `json:"status"`
	Source   string `json:"source"`
	Endpoint string `json:"endpoint"`
	Error    string `json:"error,omitempty"`
}

func (a *App) handleListConversations(w http.ResponseWriter, req *http.Request) {
	a.handleQuery(w, req, "/api/v1/conversations")
}

func (a *App) handleGetConversation(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/query/conversations/")
	if id == "" || strings.Contains(id, "/") {
		http.Error(w, "invalid conversation id", http.StatusBadRequest)
		return
	}
	a.handleQuery(w, req, fmt.Sprintf("/api/v1/conversations/%s", id))
}

func (a *App) handleListCompletions(w http.ResponseWriter, req *http.Request) {
	a.handleQuery(w, req, "/api/v1/completions")
}

func (a *App) handleGetTrace(w http.ResponseWriter, req *http.Request) {
	id := strings.TrimPrefix(req.URL.Path, "/query/traces/")
	if id == "" || strings.Contains(id, "/") {
		http.Error(w, "invalid trace id", http.StatusBadRequest)
		return
	}
	a.handleQuery(w, req, fmt.Sprintf("/api/v1/traces/%s", id))
}

func (a *App) handleQuery(w http.ResponseWriter, req *http.Request, path string) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	upstream := strings.TrimRight(a.apiURL, "/") + path
	proxyReq, err := http.NewRequestWithContext(req.Context(), http.MethodGet, upstream, nil)
	if err != nil {
		writeStub(w, http.StatusInternalServerError, path, fmt.Sprintf("build request: %v", err))
		return
	}
	proxyReq.Header = req.Header.Clone()

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

	w.Header().Set("Content-Type", "application/json")
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

func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/query/conversations", a.handleListConversations)
	mux.HandleFunc("/query/conversations/", a.handleGetConversation)
	mux.HandleFunc("/query/completions", a.handleListCompletions)
	mux.HandleFunc("/query/traces/", a.handleGetTrace)
}
