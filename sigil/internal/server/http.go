package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/query"
)

func RegisterRoutes(mux *http.ServeMux, querySvc *query.Service, generationSvc *generationingest.Service, modelCardSvc *modelcards.Service, protectedMiddleware func(http.Handler) http.Handler) {
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.HandleFunc("/healthz", health)
	mux.Handle("/api/v1/generations:export", protectedMiddleware(http.HandlerFunc(generationingest.NewHTTPHandler(generationSvc))))
	mux.Handle("/api/v1/conversations", protectedMiddleware(http.HandlerFunc(listConversations(querySvc))))
	mux.Handle("/api/v1/conversations/", protectedMiddleware(http.HandlerFunc(getConversation(querySvc))))
	mux.Handle("/api/v1/completions", protectedMiddleware(http.HandlerFunc(listCompletions(querySvc))))
	mux.Handle("/api/v1/traces/", protectedMiddleware(http.HandlerFunc(getTrace(querySvc))))

	if modelCardSvc != nil {
		mux.Handle("/api/v1/model-cards", protectedMiddleware(http.HandlerFunc(listModelCards(modelCardSvc))))
		mux.Handle("/api/v1/model-cards:lookup", protectedMiddleware(http.HandlerFunc(lookupModelCard(modelCardSvc))))
		mux.Handle("/api/v1/model-cards:sources", protectedMiddleware(http.HandlerFunc(listModelCardSources(modelCardSvc))))
		mux.Handle("/api/v1/model-cards:refresh", protectedMiddleware(http.HandlerFunc(refreshModelCards(modelCardSvc))))
	}
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func listConversations(querySvc *query.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": querySvc.ListConversations()})
	}
}

func getConversation(querySvc *query.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		id := strings.TrimPrefix(req.URL.Path, "/api/v1/conversations/")
		if id == "" || strings.Contains(id, "/") {
			http.Error(w, "invalid conversation id", http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, querySvc.GetConversation(id))
	}
}

func listCompletions(querySvc *query.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": querySvc.ListCompletions()})
	}
}

func getTrace(querySvc *query.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		id := strings.TrimPrefix(req.URL.Path, "/api/v1/traces/")
		if id == "" || strings.Contains(id, "/") {
			http.Error(w, "invalid trace id", http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, querySvc.GetTrace(id))
	}
}

func listModelCards(svc *modelcards.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		params, err := parseListParams(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		result, err := svc.List(req.Context(), params)
		if err != nil {
			http.Error(w, "failed to list model cards", http.StatusInternalServerError)
			return
		}

		nextCursor := ""
		if result.HasMore {
			nextCursor = modelcards.EncodeCursor(result.NextOffset)
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"data":        result.Data,
			"next_cursor": nextCursor,
			"freshness":   result.Freshness,
		})
	}
}

func lookupModelCard(svc *modelcards.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		modelKey := strings.TrimSpace(req.URL.Query().Get("model_key"))
		source := strings.TrimSpace(req.URL.Query().Get("source"))
		sourceModelID := strings.TrimSpace(req.URL.Query().Get("source_model_id"))

		if modelKey == "" && (source == "" || sourceModelID == "") {
			http.Error(w, "either model_key or source+source_model_id is required", http.StatusBadRequest)
			return
		}

		card, freshness, err := svc.Lookup(req.Context(), modelKey, source, sourceModelID)
		if errors.Is(err, modelcards.ErrNotFound) {
			http.Error(w, "model card not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "failed to lookup model card", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"data":      card,
			"freshness": freshness,
		})
	}
}

func listModelCardSources(svc *modelcards.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		statuses, err := svc.SourceStatuses(req.Context())
		if err != nil {
			http.Error(w, "failed to list model-card source statuses", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": statuses})
	}
}

func refreshModelCards(svc *modelcards.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		payload := struct {
			Source string `json:"source"`
			Mode   string `json:"mode"`
		}{}
		if req.Body != nil {
			decoder := json.NewDecoder(req.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
		}

		if payload.Source != "" && payload.Source != modelcards.SourceOpenRouter {
			http.Error(w, "unsupported source", http.StatusBadRequest)
			return
		}

		run, err := svc.RefreshNow(req.Context(), payload.Mode)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"run": run, "error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"run": run})
	}
}

func parseListParams(req *http.Request) (modelcards.ListParams, error) {
	query := req.URL.Query()

	limit := 50
	if rawLimit := strings.TrimSpace(query.Get("limit")); rawLimit != "" {
		value, err := strconv.Atoi(rawLimit)
		if err != nil || value <= 0 {
			return modelcards.ListParams{}, errors.New("invalid limit")
		}
		if value > 200 {
			value = 200
		}
		limit = value
	}

	offset, err := modelcards.DecodeCursor(query.Get("cursor"))
	if err != nil {
		return modelcards.ListParams{}, err
	}

	params := modelcards.ListParams{
		Q:        strings.TrimSpace(query.Get("q")),
		Source:   strings.TrimSpace(query.Get("source")),
		Provider: strings.TrimSpace(query.Get("provider")),
		Sort:     strings.TrimSpace(query.Get("sort")),
		Order:    strings.TrimSpace(query.Get("order")),
		Limit:    limit,
		Offset:   offset,
	}

	if rawFreeOnly := strings.TrimSpace(query.Get("free_only")); rawFreeOnly != "" {
		value, err := strconv.ParseBool(rawFreeOnly)
		if err != nil {
			return modelcards.ListParams{}, errors.New("invalid free_only")
		}
		params.FreeOnly = &value
	}
	if rawMinContext := strings.TrimSpace(query.Get("min_context_length")); rawMinContext != "" {
		value, err := strconv.Atoi(rawMinContext)
		if err != nil {
			return modelcards.ListParams{}, errors.New("invalid min_context_length")
		}
		params.MinContextLength = &value
	}
	if rawMaxPrompt := strings.TrimSpace(query.Get("max_prompt_price_usd_per_token")); rawMaxPrompt != "" {
		value, err := strconv.ParseFloat(rawMaxPrompt, 64)
		if err != nil {
			return modelcards.ListParams{}, errors.New("invalid max_prompt_price_usd_per_token")
		}
		params.MaxPromptPriceUSDPerToken = &value
	}
	if rawMaxCompletion := strings.TrimSpace(query.Get("max_completion_price_usd_per_token")); rawMaxCompletion != "" {
		value, err := strconv.ParseFloat(rawMaxCompletion, 64)
		if err != nil {
			return modelcards.ListParams{}, errors.New("invalid max_completion_price_usd_per_token")
		}
		params.MaxCompletionPriceUSDPerToken = &value
	}

	return params, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
