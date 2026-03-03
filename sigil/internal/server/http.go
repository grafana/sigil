package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/grafana/dskit/tenant"
	"github.com/grafana/sigil/sigil/internal/feedback"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func RegisterRoutes(
	mux *http.ServeMux,
	querySvc *query.Service,
	generationSvc *generationingest.Service,
	feedbackSvc *feedback.Service,
	ratingsEnabled bool,
	annotationsEnabled bool,
	modelCardSvc *modelcards.Service,
	protectedMiddleware func(http.Handler) http.Handler,
) {
	RegisterCoreRoutes(mux)
	RegisterIngestRoutes(mux, generationSvc, protectedMiddleware)
	RegisterQueryRoutes(mux, querySvc, feedbackSvc, ratingsEnabled, annotationsEnabled, modelCardSvc, protectedMiddleware)
}

// RegisterCoreRoutes wires transport-level routes shared by every runtime role.
func RegisterCoreRoutes(mux *http.ServeMux) {
	if mux == nil {
		return
	}
	mux.HandleFunc("/healthz", health)
	mux.Handle("/metrics", promhttp.Handler())
}

// RegisterIngestRoutes wires generation ingest HTTP routes.
func RegisterIngestRoutes(
	mux *http.ServeMux,
	generationSvc *generationingest.Service,
	protectedMiddleware func(http.Handler) http.Handler,
) {
	if mux == nil || generationSvc == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}
	mux.Handle("/api/v1/generations:export", protectedMiddleware(http.HandlerFunc(generationingest.NewHTTPHandler(generationSvc))))
}

// RegisterQueryRoutes wires query/read HTTP routes without proxy endpoints.
func RegisterQueryRoutes(
	mux *http.ServeMux,
	querySvc *query.Service,
	feedbackSvc *feedback.Service,
	ratingsEnabled bool,
	annotationsEnabled bool,
	modelCardSvc *modelcards.Service,
	protectedMiddleware func(http.Handler) http.Handler,
) {
	if mux == nil || querySvc == nil {
		return
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("/api/v1/generations/", protectedMiddleware(http.HandlerFunc(getGeneration(querySvc))))
	mux.Handle("/api/v1/conversations:batch-metadata", protectedMiddleware(http.HandlerFunc(batchConversationMetadata(querySvc))))
	mux.Handle("/api/v1/conversations", protectedMiddleware(http.HandlerFunc(listConversations(querySvc))))
	mux.Handle("/api/v1/conversations/", protectedMiddleware(http.HandlerFunc(conversationRoutes(querySvc, feedbackSvc, ratingsEnabled, annotationsEnabled))))

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

		tenantID, err := tenant.TenantID(req.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		filter, err := parseConversationListFilter(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		items, err := querySvc.ListConversationsForTenant(req.Context(), tenantID, filter)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func batchConversationMetadata(querySvc *query.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		tenantID, err := tenant.TenantID(req.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		var payload struct {
			ConversationIDs []string `json:"conversation_ids"`
		}
		if req.Body != nil {
			decoder := json.NewDecoder(req.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
		}
		if len(payload.ConversationIDs) > 500 {
			http.Error(w, "conversation_ids exceeds maximum of 500", http.StatusBadRequest)
			return
		}

		items, missingConversationIDs, err := querySvc.ListConversationBatchMetadataForTenant(req.Context(), tenantID, payload.ConversationIDs)
		if err != nil {
			if query.IsValidationError(err) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if items == nil {
			items = []query.ConversationBatchMetadata{}
		}
		if missingConversationIDs == nil {
			missingConversationIDs = []string{}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":                    items,
			"missing_conversation_ids": missingConversationIDs,
		})
	}
}

func conversationRoutes(querySvc *query.Service, feedbackSvc *feedback.Service, ratingsEnabled bool, annotationsEnabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		id, childPath, ok := parseConversationSubPath(req.URL.Path)
		if !ok {
			http.Error(w, "invalid conversation path", http.StatusBadRequest)
			return
		}

		if childPath == "" {
			if req.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}

			tenantID, err := tenant.TenantID(req.Context())
			if err != nil {
				http.Error(w, err.Error(), http.StatusUnauthorized)
				return
			}

			item, found, err := querySvc.GetConversationDetailForTenant(req.Context(), tenantID, id)
			if err != nil {
				if query.IsValidationError(err) {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			if !found {
				http.NotFound(w, req)
				return
			}
			writeJSON(w, http.StatusOK, item)
			return
		}

		if feedbackSvc == nil {
			http.NotFound(w, req)
			return
		}

		switch childPath {
		case "ratings":
			if !ratingsEnabled {
				http.NotFound(w, req)
				return
			}
			handleConversationRatings(w, req, feedbackSvc, id)
		case "annotations":
			if !annotationsEnabled {
				http.NotFound(w, req)
				return
			}
			handleConversationAnnotations(w, req, feedbackSvc, id)
		default:
			http.NotFound(w, req)
		}
	}
}

func getGeneration(querySvc *query.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		id, childPath, ok := parseGenerationSubPath(req.URL.Path)
		if !ok {
			http.Error(w, "invalid generation path", http.StatusBadRequest)
			return
		}

		tenantID, err := tenant.TenantID(req.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		if childPath == "scores" {
			limit, cursor, err := parseGenerationScorePagination(req)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			items, nextCursor, err := querySvc.ListGenerationScoresForTenant(req.Context(), tenantID, id, limit, cursor)
			if err != nil {
				if query.IsValidationError(err) {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			nextCursorValue := ""
			if nextCursor > 0 {
				nextCursorValue = strconv.FormatUint(nextCursor, 10)
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"items":       items,
				"next_cursor": nextCursorValue,
			})
			return
		}

		if childPath != "" {
			http.NotFound(w, req)
			return
		}

		item, found, err := querySvc.GetGenerationDetailForTenant(req.Context(), tenantID, id)
		if err != nil {
			if query.IsValidationError(err) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if !found {
			http.NotFound(w, req)
			return
		}
		writeJSON(w, http.StatusOK, item)
	}
}

func parseGenerationSubPath(path string) (id string, childPath string, ok bool) {
	trimmed := strings.TrimPrefix(path, "/api/v1/generations/")
	if trimmed == "" {
		return "", "", false
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) == 1 {
		if strings.TrimSpace(parts[0]) == "" {
			return "", "", false
		}
		return parts[0], "", true
	}
	if len(parts) == 2 {
		if strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
			return "", "", false
		}
		return parts[0], parts[1], true
	}
	return "", "", false
}

func parseGenerationScorePagination(req *http.Request) (int, uint64, error) {
	limit := 50
	if rawLimit := strings.TrimSpace(req.URL.Query().Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed <= 0 {
			return 0, 0, errors.New("invalid limit")
		}
		limit = parsed
	}
	if limit > 500 {
		limit = 500
	}

	var cursor uint64
	if rawCursor := strings.TrimSpace(req.URL.Query().Get("cursor")); rawCursor != "" {
		parsed, err := strconv.ParseUint(rawCursor, 10, 64)
		if err != nil {
			return 0, 0, errors.New("invalid cursor")
		}
		cursor = parsed
	}
	return limit, cursor, nil
}

func handleConversationRatings(w http.ResponseWriter, req *http.Request, feedbackSvc *feedback.Service, conversationID string) {
	tenantID, err := tenant.TenantID(req.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	switch req.Method {
	case http.MethodPost:
		var input feedback.CreateConversationRatingInput
		if req.Body != nil {
			decoder := json.NewDecoder(req.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&input); err != nil && !errors.Is(err, io.EOF) {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
		}

		rating, summary, err := feedbackSvc.CreateRating(req.Context(), tenantID, conversationID, input)
		if err != nil {
			writeFeedbackError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"rating":  rating,
			"summary": summary,
		})
	case http.MethodGet:
		limit, cursor, ok := parsePaginationQuery(w, req)
		if !ok {
			return
		}

		items, nextCursor, err := feedbackSvc.ListRatings(req.Context(), tenantID, conversationID, limit, cursor)
		if err != nil {
			writeFeedbackError(w, err)
			return
		}
		next := ""
		if nextCursor > 0 {
			next = strconv.FormatUint(nextCursor, 10)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       items,
			"next_cursor": next,
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleConversationAnnotations(w http.ResponseWriter, req *http.Request, feedbackSvc *feedback.Service, conversationID string) {
	tenantID, err := tenant.TenantID(req.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	switch req.Method {
	case http.MethodPost:
		var input feedback.CreateConversationAnnotationInput
		if req.Body != nil {
			decoder := json.NewDecoder(req.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&input); err != nil && !errors.Is(err, io.EOF) {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
		}

		operator := feedback.OperatorIdentity{
			OperatorID:    strings.TrimSpace(req.Header.Get(feedback.HeaderOperatorID)),
			OperatorLogin: strings.TrimSpace(req.Header.Get(feedback.HeaderOperatorLogin)),
			OperatorName:  strings.TrimSpace(req.Header.Get(feedback.HeaderOperatorName)),
		}

		annotation, summary, err := feedbackSvc.CreateAnnotation(req.Context(), tenantID, conversationID, operator, input)
		if err != nil {
			writeFeedbackError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"annotation": annotation,
			"summary":    summary,
		})
	case http.MethodGet:
		limit, cursor, ok := parsePaginationQuery(w, req)
		if !ok {
			return
		}

		items, nextCursor, err := feedbackSvc.ListAnnotations(req.Context(), tenantID, conversationID, limit, cursor)
		if err != nil {
			writeFeedbackError(w, err)
			return
		}
		next := ""
		if nextCursor > 0 {
			next = strconv.FormatUint(nextCursor, 10)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       items,
			"next_cursor": next,
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func writeFeedbackError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, feedback.ErrConflict):
		http.Error(w, err.Error(), http.StatusConflict)
	case feedback.IsValidationError(err):
		http.Error(w, err.Error(), http.StatusBadRequest)
	default:
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}
}

func parseConversationSubPath(path string) (string, string, bool) {
	trimmed := strings.TrimPrefix(path, "/api/v1/conversations/")
	if trimmed == path || trimmed == "" {
		return "", "", false
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) == 1 {
		if parts[0] == "" {
			return "", "", false
		}
		return parts[0], "", true
	}
	if len(parts) == 2 {
		if parts[0] == "" || parts[1] == "" {
			return "", "", false
		}
		return parts[0], parts[1], true
	}
	return "", "", false
}

func parsePaginationQuery(w http.ResponseWriter, req *http.Request) (int, uint64, bool) {
	limit, err := feedback.NormalizeLimit(req.URL.Query().Get("limit"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return 0, 0, false
	}
	cursor, err := feedback.NormalizeCursor(req.URL.Query().Get("cursor"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return 0, 0, false
	}
	return limit, cursor, true
}

func parseConversationListFilter(req *http.Request) (query.ConversationListFilter, error) {
	filter := query.ConversationListFilter{}

	hasBadRating, err := parseOptionalBoolQuery(req, "has_bad_rating")
	if err != nil {
		return query.ConversationListFilter{}, errors.New("invalid has_bad_rating")
	}
	filter.HasBadRating = hasBadRating

	hasAnnotations, err := parseOptionalBoolQuery(req, "has_annotations")
	if err != nil {
		return query.ConversationListFilter{}, errors.New("invalid has_annotations")
	}
	filter.HasAnnotations = hasAnnotations

	return filter, nil
}

func parseOptionalBoolQuery(req *http.Request, key string) (*bool, error) {
	raw := strings.TrimSpace(req.URL.Query().Get(key))
	if raw == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseBool(raw)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func listModelCards(svc *modelcards.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		if hasResolvePairs(req) {
			inputs, err := parseResolvePairs(req)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			resolved, freshness, err := svc.ResolveBatch(req.Context(), inputs)
			if err != nil {
				http.Error(w, "failed to resolve model cards", http.StatusInternalServerError)
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{
				"resolved":  resolved,
				"freshness": freshness,
			})
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

func hasResolvePairs(req *http.Request) bool {
	if req == nil {
		return false
	}
	_, ok := req.URL.Query()["resolve_pair"]
	return ok
}

func parseResolvePairs(req *http.Request) ([]modelcards.ResolveInput, error) {
	query := req.URL.Query()
	rawPairs := query["resolve_pair"]
	if len(rawPairs) == 0 {
		return nil, errors.New("resolve_pair is required")
	}
	if len(rawPairs) > 100 {
		return nil, errors.New("too many resolve_pair values")
	}

	for key := range query {
		if key != "resolve_pair" {
			return nil, errors.New("resolve_pair cannot be combined with other query params")
		}
	}

	inputs := make([]modelcards.ResolveInput, 0, len(rawPairs))
	for _, rawPair := range rawPairs {
		parts := strings.SplitN(strings.TrimSpace(rawPair), ":", 2)
		if len(parts) != 2 {
			return nil, errors.New("invalid resolve_pair")
		}
		provider := strings.TrimSpace(parts[0])
		model := strings.TrimSpace(parts[1])
		if provider == "" || model == "" {
			return nil, errors.New("invalid resolve_pair")
		}
		inputs = append(inputs, modelcards.ResolveInput{
			Provider: provider,
			Model:    model,
		})
	}
	return inputs, nil
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

	if rawRegex := strings.TrimSpace(query.Get("regex")); rawRegex != "" {
		compiled, err := regexp.Compile(rawRegex)
		if err != nil {
			return modelcards.ListParams{}, errors.New("invalid regex")
		}
		params.Regex = compiled
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
