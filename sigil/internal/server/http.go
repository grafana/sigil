package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	kitlog "github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"github.com/grafana/dskit/tenant"
	"github.com/grafana/sigil/sigil/internal/agentrating"
	"github.com/grafana/sigil/sigil/internal/feedback"
	"github.com/grafana/sigil/sigil/internal/followup"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/jsonutil"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/promptinsights"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const (
	agentRatingEvaluationTimeout       = 3 * time.Minute
	agentRatingPersistTimeout          = 10 * time.Second
	promptInsightsEvaluationTimeout    = 3 * time.Minute
	promptInsightsPersistTimeout       = 10 * time.Second
	promptInsightsConversationLimit    = 15
	promptInsightsConversationLookback = 7 * 24 * time.Hour
)

var validLookbacks = map[string]time.Duration{
	"6h":  6 * time.Hour,
	"12h": 12 * time.Hour,
	"1d":  24 * time.Hour,
	"3d":  3 * 24 * time.Hour,
	"7d":  7 * 24 * time.Hour,
}

func parseLookback(raw string) time.Duration {
	if d, ok := validLookbacks[strings.TrimSpace(raw)]; ok {
		return d
	}
	return promptInsightsConversationLookback
}

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
	RegisterQueryRoutes(
		mux,
		querySvc,
		nil,
		nil,
		feedbackSvc,
		ratingsEnabled,
		annotationsEnabled,
		modelCardSvc,
		kitlog.NewNopLogger(),
		protectedMiddleware,
		nil,
	)
}

// RegisterCoreRoutes wires transport-level routes shared by every runtime role.
func RegisterCoreRoutes(mux *http.ServeMux) {
	if mux == nil {
		return
	}
	mux.Handle("/healthz", recoverHTTPPanics(http.HandlerFunc(health)))
	mux.Handle("/metrics", recoverHTTPPanics(promhttp.Handler()))
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
	mux.Handle(
		"/api/v1/generations:export",
		recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(generationingest.NewHTTPHandler(generationSvc)))),
	)
}

// RegisterQueryRoutes wires query/read HTTP routes without proxy endpoints.
func RegisterQueryRoutes(
	mux *http.ServeMux,
	querySvc *query.Service,
	rater *agentrating.Rater,
	ratingStore agentrating.LatestStore,
	feedbackSvc *feedback.Service,
	ratingsEnabled bool,
	annotationsEnabled bool,
	modelCardSvc *modelcards.Service,
	logger kitlog.Logger,
	protectedMiddleware func(http.Handler) http.Handler,
	followupSvc *followup.Service,
	promptInsightsOpts ...PromptInsightsOption,
) {
	if mux == nil || querySvc == nil {
		return
	}
	if logger == nil {
		logger = kitlog.NewNopLogger()
	}
	if protectedMiddleware == nil {
		protectedMiddleware = func(next http.Handler) http.Handler { return next }
	}

	mux.Handle("/api/v1/generations/", recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(getGeneration(querySvc)))))
	mux.Handle("/api/v1/agents", recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(listAgents(querySvc)))))
	mux.Handle("/api/v1/agents:lookup", recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(lookupAgent(querySvc)))))
	mux.Handle(
		"/api/v1/agents:versions",
		recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(listAgentVersions(querySvc)))),
	)
	if ratingStore != nil {
		mux.Handle(
			"/api/v1/agents:rating",
			recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(lookupAgentRating(querySvc, ratingStore)))),
		)
	}
	if rater != nil && ratingStore != nil {
		mux.Handle(
			"/api/v1/agents:rate",
			recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(rateAgent(querySvc, rater, ratingStore, logger)))),
		)
	}
	var piOpts PromptInsightsOption
	if len(promptInsightsOpts) > 0 {
		piOpts = promptInsightsOpts[0]
	}

	mux.Handle(
		"/api/v1/conversations:batch-metadata",
		recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(batchConversationMetadata(querySvc)))),
	)
	mux.Handle(
		"/api/v1/conversations/search",
		recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(searchConversations(querySvc)))),
	)
	mux.Handle(
		"/api/v1/conversations/search/stream",
		recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(streamSearchConversations(querySvc)))),
	)
	mux.Handle(
		"/api/v1/conversations/stats",
		recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(conversationStats(querySvc)))),
	)
	mux.Handle("/api/v1/conversations", recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(listConversations(querySvc)))))
	mux.Handle(
		"/api/v1/conversations/",
		recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(conversationRoutes(querySvc, feedbackSvc, ratingsEnabled, annotationsEnabled, followupSvc)))),
	)
	mux.Handle("/api/v2/conversations/", recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(conversationRoutesV2(querySvc)))))

	if modelCardSvc != nil {
		mux.Handle(
			"/api/v1/model-cards",
			recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(listModelCards(modelCardSvc)))),
		)
		mux.Handle(
			"/api/v1/model-cards:lookup",
			recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(lookupModelCard(modelCardSvc)))),
		)
		mux.Handle(
			"/api/v1/model-cards:sources",
			recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(listModelCardSources(modelCardSvc)))),
		)
		mux.Handle(
			"/api/v1/model-cards:refresh",
			recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(refreshModelCards(modelCardSvc)))),
		)
	}
	if piOpts.Store != nil {
		mux.Handle(
			"/api/v1/agents:prompt-insights",
			recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(lookupPromptInsights(querySvc, piOpts.Store)))),
		)
	}
	if piOpts.Analyzer != nil && piOpts.Store != nil {
		mux.Handle(
			"/api/v1/agents:analyze-prompt",
			recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(analyzePrompt(querySvc, piOpts.Analyzer, piOpts.Store, rater, ratingStore, logger)))),
		)
		mux.Handle(
			"/api/v1/agents:analyze-prompt-with-excerpts",
			recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(analyzePromptWithExcerpts(querySvc, piOpts.Analyzer, piOpts.Store, rater, ratingStore, logger)))),
		)
	} else if piOpts.Store != nil {
		noJudge := func(w http.ResponseWriter, req *http.Request) {
			http.Error(w, "prompt analysis is unavailable: no judge provider is configured", http.StatusServiceUnavailable)
		}
		mux.Handle("/api/v1/agents:analyze-prompt", recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(noJudge))))
		mux.Handle(
			"/api/v1/agents:analyze-prompt-with-excerpts",
			recoverHTTPPanics(protectedMiddleware(http.HandlerFunc(noJudge))),
		)
	}
}

type panicRecoveryResponseWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *panicRecoveryResponseWriter) WriteHeader(statusCode int) {
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *panicRecoveryResponseWriter) Write(p []byte) (int, error) {
	w.wroteHeader = true
	return w.ResponseWriter.Write(p)
}

func (w *panicRecoveryResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *panicRecoveryResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func recoverHTTPPanics(next http.Handler) http.Handler {
	if next == nil {
		return http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		writer := &panicRecoveryResponseWriter{ResponseWriter: w}
		defer func() {
			recovered := recover()
			if recovered == nil {
				return
			}

			tenantID, _ := tenant.TenantID(req.Context())
			slog.Error(
				"sigil api panic recovered",
				"method", req.Method,
				"path", req.URL.Path,
				"tenant_id", tenantID,
				"request_id", strings.TrimSpace(req.Header.Get("X-Request-Id")),
				"trace_id", strings.TrimSpace(req.Header.Get("X-Cloud-Trace-Context")),
				"panic", fmt.Sprint(recovered),
				"stack", string(debug.Stack()),
			)

			if !writer.wroteHeader {
				http.Error(writer, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(writer, req)
	})
}

// PromptInsightsOption carries optional dependencies for prompt insights routes.
type PromptInsightsOption struct {
	Analyzer *promptinsights.Analyzer
	Store    promptinsights.Store
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

func conversationRoutes(querySvc *query.Service, feedbackSvc *feedback.Service, ratingsEnabled bool, annotationsEnabled bool, followupSvc *followup.Service) http.HandlerFunc {
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

			format := strings.TrimSpace(req.URL.Query().Get("format"))
			if format == "v2" {
				item, found, err := querySvc.GetConversationDetailV2ForTenant(req.Context(), tenantID, id)
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
			if format != "" {
				http.Error(w, "invalid format", http.StatusBadRequest)
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

		switch childPath {
		case "followup":
			handleConversationFollowup(w, req, querySvc, followupSvc, id)
		case "ratings":
			if feedbackSvc == nil || !ratingsEnabled {
				http.NotFound(w, req)
				return
			}
			handleConversationRatings(w, req, feedbackSvc, id)
		case "annotations":
			if feedbackSvc == nil || !annotationsEnabled {
				http.NotFound(w, req)
				return
			}
			handleConversationAnnotations(w, req, feedbackSvc, id)
		default:
			http.NotFound(w, req)
		}
	}
}

func conversationRoutesV2(querySvc *query.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		id, ok := parseSingleConversationPath(req.URL.Path, "/api/v2/conversations/")
		if !ok {
			http.Error(w, "invalid conversation path", http.StatusBadRequest)
			return
		}
		if req.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		tenantID, err := tenant.TenantID(req.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		item, found, err := querySvc.GetConversationDetailV2ForTenant(req.Context(), tenantID, id)
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

func handleConversationFollowup(w http.ResponseWriter, req *http.Request, querySvc *query.Service, followupSvc *followup.Service, conversationID string) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if followupSvc == nil {
		http.Error(w, "followup is unavailable: no judge provider is configured", http.StatusServiceUnavailable)
		return
	}

	tenantID, err := tenant.TenantID(req.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	var payload struct {
		GenerationID string `json:"generation_id"`
		Message      string `json:"message"`
		Model        string `json:"model,omitempty"`
	}
	if req.Body == nil {
		http.Error(w, "request body is required", http.StatusBadRequest)
		return
	}
	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := jsonutil.EnsureEOF(decoder); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	generations, found, err := querySvc.ListConversationGenerationsForTenant(req.Context(), tenantID, conversationID)
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

	resp, err := followupSvc.Followup(req.Context(), generations, followup.Request{
		ConversationID: conversationID,
		GenerationID:   payload.GenerationID,
		Message:        payload.Message,
		Model:          payload.Model,
	})
	if err != nil {
		if followup.IsValidationError(err) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, resp)
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

		plan, err := parseGenerationDetailReadPlan(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		item, found, err := querySvc.GetGenerationDetailForTenantWithPlan(req.Context(), tenantID, id, plan)
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

func listAgents(querySvc *query.Service) http.HandlerFunc {
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

		limit := 50
		if rawLimit := strings.TrimSpace(req.URL.Query().Get("limit")); rawLimit != "" {
			value, err := strconv.Atoi(rawLimit)
			if err != nil || value <= 0 {
				http.Error(w, "invalid limit", http.StatusBadRequest)
				return
			}
			if value > 200 {
				value = 200
			}
			limit = value
		}

		filter := query.AgentListFilter{
			NamePrefix: req.URL.Query().Get("name_prefix"),
		}
		if rawSeenAfter := strings.TrimSpace(req.URL.Query().Get("seen_after")); rawSeenAfter != "" {
			epochSec, parseErr := strconv.ParseInt(rawSeenAfter, 10, 64)
			if parseErr != nil || epochSec < 0 {
				http.Error(w, "invalid seen_after", http.StatusBadRequest)
				return
			}
			filter.SeenAfter = time.Unix(epochSec, 0).UTC()
		}
		if rawSeenBefore := strings.TrimSpace(req.URL.Query().Get("seen_before")); rawSeenBefore != "" {
			epochSec, parseErr := strconv.ParseInt(rawSeenBefore, 10, 64)
			if parseErr != nil || epochSec < 0 {
				http.Error(w, "invalid seen_before", http.StatusBadRequest)
				return
			}
			filter.SeenBefore = time.Unix(epochSec, 0).UTC()
		}

		items, nextCursor, err := querySvc.ListAgentsForTenant(
			req.Context(),
			tenantID,
			limit,
			req.URL.Query().Get("cursor"),
			filter,
		)
		if err != nil {
			if query.IsValidationError(err) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if items == nil {
			items = []query.AgentListItem{}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       items,
			"next_cursor": nextCursor,
		})
	}
}

func lookupAgent(querySvc *query.Service) http.HandlerFunc {
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

		rawNames, hasName := req.URL.Query()["name"]
		if !hasName {
			http.Error(w, "name query param is required", http.StatusBadRequest)
			return
		}

		agentName := ""
		if len(rawNames) > 0 {
			agentName = rawNames[0]
		}

		item, found, err := querySvc.GetAgentDetailForTenant(
			req.Context(),
			tenantID,
			agentName,
			req.URL.Query().Get("version"),
		)
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

func listAgentVersions(querySvc *query.Service) http.HandlerFunc {
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

		rawNames, hasName := req.URL.Query()["name"]
		if !hasName {
			http.Error(w, "name query param is required", http.StatusBadRequest)
			return
		}

		agentName := ""
		if len(rawNames) > 0 {
			agentName = rawNames[0]
		}

		limit := 50
		if rawLimit := strings.TrimSpace(req.URL.Query().Get("limit")); rawLimit != "" {
			value, err := strconv.Atoi(rawLimit)
			if err != nil || value <= 0 {
				http.Error(w, "invalid limit", http.StatusBadRequest)
				return
			}
			if value > 200 {
				value = 200
			}
			limit = value
		}

		items, nextCursor, err := querySvc.ListAgentVersionsForTenant(
			req.Context(),
			tenantID,
			agentName,
			limit,
			req.URL.Query().Get("cursor"),
		)
		if err != nil {
			if query.IsValidationError(err) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if items == nil {
			items = []query.AgentVersionListItem{}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       items,
			"next_cursor": nextCursor,
		})
	}
}

type rateAgentRequest struct {
	AgentName string `json:"agent_name"`
	Version   string `json:"version,omitempty"`
	Model     string `json:"model,omitempty"`
}

func rateAgent(
	querySvc *query.Service,
	rater *agentrating.Rater,
	ratingStore agentrating.LatestStore,
	logger kitlog.Logger,
) http.HandlerFunc {
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

		var payload rateAgentRequest
		if req.Body == nil {
			http.Error(w, "request body is required", http.StatusBadRequest)
			return
		}
		decoder := json.NewDecoder(req.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&payload); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := jsonutil.EnsureEOF(decoder); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		agentDetail, found, err := querySvc.GetAgentDetailForTenant(req.Context(), tenantID, payload.AgentName, payload.Version)
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

		existingRating, err := ratingStore.GetAgentVersionRating(
			req.Context(),
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
		)
		if err != nil {
			http.Error(w, "failed to read existing agent rating", http.StatusInternalServerError)
			return
		}
		if existingRating != nil && agentrating.NormalizeRatingStatus(existingRating.Status) == agentrating.RatingStatusPending {
			existingRating.Status = agentrating.RatingStatusPending
			writeJSON(w, http.StatusAccepted, existingRating)
			return
		}

		pendingRating := agentrating.Rating{
			Status:      agentrating.RatingStatusPending,
			Suggestions: []agentrating.Suggestion{},
		}
		if err := ratingStore.UpsertAgentVersionRating(
			req.Context(),
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
			pendingRating,
		); err != nil {
			http.Error(w, "failed to persist pending agent rating", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusAccepted, pendingRating)

		ratingInput := mapAgentDetailToRatingAgent(agentDetail)
		go evaluateAgentRating(
			logger,
			rater,
			ratingStore,
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
			ratingInput,
			payload.Model,
		)
	}
}

func evaluateAgentRating(
	logger kitlog.Logger,
	rater *agentrating.Rater,
	ratingStore agentrating.LatestStore,
	tenantID string,
	agentName string,
	effectiveVersion string,
	ratingInput agentrating.Agent,
	modelOverride string,
) {
	defer func() {
		if recovered := recover(); recovered != nil {
			_ = level.Error(logger).Log(
				"msg", "agent rating background evaluation panicked",
				"tenant_id", tenantID,
				"agent_name", agentName,
				"effective_version", effectiveVersion,
				"panic", recovered,
			)
			if err := upsertAgentRatingWithTimeout(
				ratingStore,
				tenantID,
				agentName,
				effectiveVersion,
				agentrating.Rating{
					Status:      agentrating.RatingStatusFailed,
					Suggestions: []agentrating.Suggestion{},
				},
			); err != nil {
				_ = level.Error(logger).Log(
					"msg", "failed to persist failed agent rating after panic",
					"tenant_id", tenantID,
					"agent_name", agentName,
					"effective_version", effectiveVersion,
					"err", err,
				)
			}
		}
	}()

	evalCtx, cancel := context.WithTimeout(context.Background(), agentRatingEvaluationTimeout)
	defer cancel()

	rating, err := rater.RateWithModel(evalCtx, ratingInput, modelOverride)
	if err != nil {
		_ = level.Error(logger).Log(
			"msg", "agent rating background evaluation failed",
			"tenant_id", tenantID,
			"agent_name", agentName,
			"effective_version", effectiveVersion,
			"model_override", modelOverride,
			"timeout", errors.Is(evalCtx.Err(), context.DeadlineExceeded),
			"err", err,
		)
		if persistErr := upsertAgentRatingWithTimeout(
			ratingStore,
			tenantID,
			agentName,
			effectiveVersion,
			agentrating.Rating{
				Status:      agentrating.RatingStatusFailed,
				Suggestions: []agentrating.Suggestion{},
			},
		); persistErr != nil {
			_ = level.Error(logger).Log(
				"msg", "failed to persist failed agent rating after judge error",
				"tenant_id", tenantID,
				"agent_name", agentName,
				"effective_version", effectiveVersion,
				"err", persistErr,
			)
		}
		return
	}
	if rating == nil {
		_ = level.Error(logger).Log(
			"msg", "agent rating background evaluation returned nil rating",
			"tenant_id", tenantID,
			"agent_name", agentName,
			"effective_version", effectiveVersion,
		)
		if err := upsertAgentRatingWithTimeout(
			ratingStore,
			tenantID,
			agentName,
			effectiveVersion,
			agentrating.Rating{
				Status:      agentrating.RatingStatusFailed,
				Suggestions: []agentrating.Suggestion{},
			},
		); err != nil {
			_ = level.Error(logger).Log(
				"msg", "failed to persist failed agent rating after nil judge result",
				"tenant_id", tenantID,
				"agent_name", agentName,
				"effective_version", effectiveVersion,
				"err", err,
			)
		}
		return
	}

	rating.Status = agentrating.RatingStatusCompleted
	if err := upsertAgentRatingWithTimeout(
		ratingStore,
		tenantID,
		agentName,
		effectiveVersion,
		*rating,
	); err != nil {
		_ = level.Error(logger).Log(
			"msg", "failed to persist completed agent rating",
			"tenant_id", tenantID,
			"agent_name", agentName,
			"effective_version", effectiveVersion,
			"err", err,
		)
	}
}

func upsertAgentRatingWithTimeout(
	ratingStore agentrating.LatestStore,
	tenantID string,
	agentName string,
	effectiveVersion string,
	rating agentrating.Rating,
) error {
	persistCtx, cancel := context.WithTimeout(context.Background(), agentRatingPersistTimeout)
	defer cancel()
	return ratingStore.UpsertAgentVersionRating(persistCtx, tenantID, agentName, effectiveVersion, rating)
}

func lookupAgentRating(querySvc *query.Service, ratingStore agentrating.LatestStore) http.HandlerFunc {
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

		rawNames, hasName := req.URL.Query()["name"]
		if !hasName {
			http.Error(w, "name query param is required", http.StatusBadRequest)
			return
		}

		agentName := ""
		if len(rawNames) > 0 {
			agentName = rawNames[0]
		}

		agentDetail, found, err := querySvc.GetAgentDetailForTenant(
			req.Context(),
			tenantID,
			agentName,
			req.URL.Query().Get("version"),
		)
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

		rating, err := ratingStore.GetAgentVersionRating(
			req.Context(),
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
		)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if rating == nil {
			http.NotFound(w, req)
			return
		}
		rating.Status = agentrating.NormalizeRatingStatus(rating.Status)

		writeJSON(w, http.StatusOK, rating)
	}
}

func mapAgentDetailToRatingAgent(item query.AgentDetail) agentrating.Agent {
	models := make([]string, 0, len(item.Models))
	for _, model := range item.Models {
		provider := strings.TrimSpace(model.Provider)
		name := strings.TrimSpace(model.Name)
		switch {
		case provider != "" && name != "":
			models = append(models, provider+"/"+name)
		case name != "":
			models = append(models, name)
		}
	}

	tools := make([]agentrating.Tool, 0, len(item.Tools))
	for _, tool := range item.Tools {
		tools = append(tools, agentrating.Tool{
			Name:            tool.Name,
			Description:     tool.Description,
			Type:            tool.Type,
			InputSchemaJSON: tool.InputSchemaJSON,
			Deferred:        tool.Deferred,
			TokenEstimate:   tool.TokenEstimate,
		})
	}

	return agentrating.Agent{
		Name:         item.AgentName,
		SystemPrompt: item.SystemPrompt,
		Tools:        tools,
		Models:       models,
		TokenEstimate: agentrating.TokenEstimate{
			SystemPrompt: item.TokenEstimate.SystemPrompt,
			ToolsTotal:   item.TokenEstimate.ToolsTotal,
			Total:        item.TokenEstimate.Total,
		},
	}
}

type analyzePromptRequest struct {
	AgentName string `json:"agent_name"`
	Version   string `json:"version,omitempty"`
	Model     string `json:"model,omitempty"`
	Lookback  string `json:"lookback,omitempty"`
}

type conversationExcerptPayload struct {
	ConversationID  string `json:"conversation_id"`
	GenerationCount int    `json:"generation_count"`
	HasErrors       bool   `json:"has_errors"`
	ToolCallCount   int    `json:"tool_call_count"`
	UserInput       string `json:"user_input"`
	AssistantOutput string `json:"assistant_output"`
}

type analyzePromptWithExcerptsRequest struct {
	AgentName string                       `json:"agent_name"`
	Version   string                       `json:"version,omitempty"`
	Model     string                       `json:"model,omitempty"`
	Excerpts  []conversationExcerptPayload `json:"excerpts"`
}

func analyzePrompt(
	querySvc *query.Service,
	analyzer *promptinsights.Analyzer,
	insightsStore promptinsights.Store,
	rater *agentrating.Rater,
	ratingStore agentrating.LatestStore,
	logger kitlog.Logger,
) http.HandlerFunc {
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

		var payload analyzePromptRequest
		if req.Body == nil {
			http.Error(w, "request body is required", http.StatusBadRequest)
			return
		}
		decoder := json.NewDecoder(req.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&payload); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := jsonutil.EnsureEOF(decoder); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		agentDetail, found, err := querySvc.GetAgentDetailForTenant(req.Context(), tenantID, payload.AgentName, payload.Version)
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

		existing, err := insightsStore.GetPromptInsights(
			req.Context(),
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
		)
		if err != nil {
			http.Error(w, "failed to read existing prompt insights", http.StatusInternalServerError)
			return
		}
		if existing != nil && promptinsights.NormalizeStatus(existing.Status) == promptinsights.StatusPending {
			existing.Status = promptinsights.StatusPending
			writeJSON(w, http.StatusAccepted, existing)
			return
		}

		pending := promptinsights.PromptInsights{
			Status:     promptinsights.StatusPending,
			Strengths:  []promptinsights.Insight{},
			Weaknesses: []promptinsights.Insight{},
		}
		if err := insightsStore.UpsertPromptInsights(
			req.Context(),
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
			pending,
		); err != nil {
			http.Error(w, "failed to persist pending prompt insights", http.StatusInternalServerError)
			return
		}

		var ratingInput *agentrating.Agent
		if rater != nil && ratingStore != nil {
			pendingRating := agentrating.Rating{
				Status:      agentrating.RatingStatusPending,
				Suggestions: []agentrating.Suggestion{},
			}
			if err := ratingStore.UpsertAgentVersionRating(
				req.Context(),
				tenantID,
				agentDetail.AgentName,
				agentDetail.EffectiveVersion,
				pendingRating,
			); err != nil {
				_ = level.Error(logger).Log(
					"msg", "failed to persist pending agent rating during unified analysis",
					"tenant_id", tenantID,
					"agent_name", agentDetail.AgentName,
					"effective_version", agentDetail.EffectiveVersion,
					"err", err,
				)
			} else {
				input := mapAgentDetailToRatingAgent(agentDetail)
				ratingInput = &input
			}
		}

		writeJSON(w, http.StatusAccepted, pending)

		go evaluateUnifiedAnalysis(
			logger,
			querySvc,
			analyzer,
			insightsStore,
			rater,
			ratingStore,
			ratingInput,
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
			agentDetail.SystemPrompt,
			payload.Model,
			parseLookback(payload.Lookback),
		)
	}
}

// evaluateUnifiedAnalysis runs prompt insights first, then agent rating
// sequentially in a single goroutine to avoid concurrent judge API calls.
func evaluateUnifiedAnalysis(
	logger kitlog.Logger,
	querySvc *query.Service,
	analyzer *promptinsights.Analyzer,
	insightsStore promptinsights.Store,
	rater *agentrating.Rater,
	ratingStore agentrating.LatestStore,
	ratingInput *agentrating.Agent,
	tenantID string,
	agentName string,
	effectiveVersion string,
	systemPrompt string,
	modelOverride string,
	lookback time.Duration,
) {
	evaluatePromptInsights(
		logger,
		querySvc,
		analyzer,
		insightsStore,
		tenantID,
		agentName,
		effectiveVersion,
		systemPrompt,
		modelOverride,
		lookback,
	)

	if rater != nil && ratingStore != nil && ratingInput != nil {
		evaluateAgentRating(
			logger,
			rater,
			ratingStore,
			tenantID,
			agentName,
			effectiveVersion,
			*ratingInput,
			modelOverride,
		)
	}
}

func analyzePromptWithExcerpts(
	querySvc *query.Service,
	analyzer *promptinsights.Analyzer,
	insightsStore promptinsights.Store,
	rater *agentrating.Rater,
	ratingStore agentrating.LatestStore,
	logger kitlog.Logger,
) http.HandlerFunc {
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

		var payload analyzePromptWithExcerptsRequest
		if req.Body == nil {
			http.Error(w, "request body is required", http.StatusBadRequest)
			return
		}
		decoder := json.NewDecoder(req.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&payload); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := jsonutil.EnsureEOF(decoder); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		agentDetail, found, err := querySvc.GetAgentDetailForTenant(req.Context(), tenantID, payload.AgentName, payload.Version)
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

		existing, err := insightsStore.GetPromptInsights(
			req.Context(),
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
		)
		if err != nil {
			http.Error(w, "failed to read existing prompt insights", http.StatusInternalServerError)
			return
		}
		if existing != nil && promptinsights.NormalizeStatus(existing.Status) == promptinsights.StatusPending {
			existing.Status = promptinsights.StatusPending
			writeJSON(w, http.StatusAccepted, existing)
			return
		}

		pending := promptinsights.PromptInsights{
			Status:     promptinsights.StatusPending,
			Strengths:  []promptinsights.Insight{},
			Weaknesses: []promptinsights.Insight{},
		}
		if err := insightsStore.UpsertPromptInsights(
			req.Context(),
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
			pending,
		); err != nil {
			http.Error(w, "failed to persist pending prompt insights", http.StatusInternalServerError)
			return
		}

		var ratingInput *agentrating.Agent
		if rater != nil && ratingStore != nil {
			pendingRating := agentrating.Rating{
				Status:      agentrating.RatingStatusPending,
				Suggestions: []agentrating.Suggestion{},
			}
			if err := ratingStore.UpsertAgentVersionRating(
				req.Context(),
				tenantID,
				agentDetail.AgentName,
				agentDetail.EffectiveVersion,
				pendingRating,
			); err != nil {
				_ = level.Error(logger).Log(
					"msg", "failed to persist pending agent rating during unified analysis",
					"tenant_id", tenantID,
					"agent_name", agentDetail.AgentName,
					"effective_version", agentDetail.EffectiveVersion,
					"err", err,
				)
			} else {
				input := mapAgentDetailToRatingAgent(agentDetail)
				ratingInput = &input
			}
		}

		excerpts := make([]promptinsights.ConversationExcerpt, len(payload.Excerpts))
		for i, e := range payload.Excerpts {
			excerpts[i] = promptinsights.ConversationExcerpt{
				ConversationID:  e.ConversationID,
				GenerationCount: e.GenerationCount,
				HasErrors:       e.HasErrors,
				ToolCallCount:   e.ToolCallCount,
				UserInput:       e.UserInput,
				AssistantOutput: e.AssistantOutput,
			}
		}

		writeJSON(w, http.StatusAccepted, pending)

		go evaluatePromptInsightsWithExcerpts(
			logger,
			analyzer,
			insightsStore,
			rater,
			ratingStore,
			ratingInput,
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
			agentDetail.SystemPrompt,
			payload.Model,
			excerpts,
		)
	}
}

func evaluatePromptInsightsWithExcerpts(
	logger kitlog.Logger,
	analyzer *promptinsights.Analyzer,
	insightsStore promptinsights.Store,
	rater *agentrating.Rater,
	ratingStore agentrating.LatestStore,
	ratingInput *agentrating.Agent,
	tenantID string,
	agentName string,
	effectiveVersion string,
	systemPrompt string,
	modelOverride string,
	excerpts []promptinsights.ConversationExcerpt,
) {
	failedInsights := promptinsights.PromptInsights{
		Status:     promptinsights.StatusFailed,
		Strengths:  []promptinsights.Insight{},
		Weaknesses: []promptinsights.Insight{},
	}

	defer func() {
		if recovered := recover(); recovered != nil {
			_ = level.Error(logger).Log(
				"msg", "prompt insights background evaluation panicked",
				"tenant_id", tenantID,
				"agent_name", agentName,
				"effective_version", effectiveVersion,
				"panic", recovered,
			)
			_ = upsertPromptInsightsWithTimeout(insightsStore, tenantID, agentName, effectiveVersion, failedInsights)
		}
	}()

	evalCtx, cancel := context.WithTimeout(context.Background(), promptInsightsEvaluationTimeout)
	defer cancel()

	result, err := analyzer.Analyze(evalCtx, systemPrompt, excerpts, modelOverride)
	if err != nil {
		_ = level.Error(logger).Log(
			"msg", "prompt insights background evaluation failed",
			"tenant_id", tenantID,
			"agent_name", agentName,
			"effective_version", effectiveVersion,
			"model_override", modelOverride,
			"timeout", errors.Is(evalCtx.Err(), context.DeadlineExceeded),
			"err", err,
		)
		_ = upsertPromptInsightsWithTimeout(insightsStore, tenantID, agentName, effectiveVersion, failedInsights)
		return
	}
	if result == nil {
		_ = level.Error(logger).Log(
			"msg", "prompt insights background evaluation returned nil",
			"tenant_id", tenantID,
			"agent_name", agentName,
			"effective_version", effectiveVersion,
		)
		_ = upsertPromptInsightsWithTimeout(insightsStore, tenantID, agentName, effectiveVersion, failedInsights)
		return
	}

	result.Status = promptinsights.StatusCompleted
	if err := upsertPromptInsightsWithTimeout(insightsStore, tenantID, agentName, effectiveVersion, *result); err != nil {
		_ = level.Error(logger).Log(
			"msg", "failed to persist completed prompt insights",
			"tenant_id", tenantID,
			"agent_name", agentName,
			"effective_version", effectiveVersion,
			"err", err,
		)
	}

	if rater != nil && ratingStore != nil && ratingInput != nil {
		evaluateAgentRating(
			logger,
			rater,
			ratingStore,
			tenantID,
			agentName,
			effectiveVersion,
			*ratingInput,
			modelOverride,
		)
	}
}

func evaluatePromptInsights(
	logger kitlog.Logger,
	querySvc *query.Service,
	analyzer *promptinsights.Analyzer,
	insightsStore promptinsights.Store,
	tenantID string,
	agentName string,
	effectiveVersion string,
	systemPrompt string,
	modelOverride string,
	lookback time.Duration,
) {
	failedInsights := promptinsights.PromptInsights{
		Status:     promptinsights.StatusFailed,
		Strengths:  []promptinsights.Insight{},
		Weaknesses: []promptinsights.Insight{},
	}

	defer func() {
		if recovered := recover(); recovered != nil {
			_ = level.Error(logger).Log(
				"msg", "prompt insights background evaluation panicked",
				"tenant_id", tenantID,
				"agent_name", agentName,
				"effective_version", effectiveVersion,
				"panic", recovered,
			)
			_ = upsertPromptInsightsWithTimeout(insightsStore, tenantID, agentName, effectiveVersion, failedInsights)
		}
	}()

	evalCtx, cancel := context.WithTimeout(context.Background(), promptInsightsEvaluationTimeout)
	defer cancel()

	excerpts, err := fetchConversationExcerpts(evalCtx, querySvc, tenantID, agentName, lookback)
	if err != nil {
		_ = level.Error(logger).Log(
			"msg", "prompt insights failed to fetch conversations",
			"tenant_id", tenantID,
			"agent_name", agentName,
			"err", err,
		)
		_ = upsertPromptInsightsWithTimeout(insightsStore, tenantID, agentName, effectiveVersion, failedInsights)
		return
	}

	result, err := analyzer.Analyze(evalCtx, systemPrompt, excerpts, modelOverride)
	if err != nil {
		_ = level.Error(logger).Log(
			"msg", "prompt insights background evaluation failed",
			"tenant_id", tenantID,
			"agent_name", agentName,
			"effective_version", effectiveVersion,
			"model_override", modelOverride,
			"timeout", errors.Is(evalCtx.Err(), context.DeadlineExceeded),
			"err", err,
		)
		_ = upsertPromptInsightsWithTimeout(insightsStore, tenantID, agentName, effectiveVersion, failedInsights)
		return
	}
	if result == nil {
		_ = level.Error(logger).Log(
			"msg", "prompt insights background evaluation returned nil",
			"tenant_id", tenantID,
			"agent_name", agentName,
			"effective_version", effectiveVersion,
		)
		_ = upsertPromptInsightsWithTimeout(insightsStore, tenantID, agentName, effectiveVersion, failedInsights)
		return
	}

	result.Status = promptinsights.StatusCompleted
	if err := upsertPromptInsightsWithTimeout(insightsStore, tenantID, agentName, effectiveVersion, *result); err != nil {
		_ = level.Error(logger).Log(
			"msg", "failed to persist completed prompt insights",
			"tenant_id", tenantID,
			"agent_name", agentName,
			"effective_version", effectiveVersion,
			"err", err,
		)
	}
}

func fetchConversationExcerpts(ctx context.Context, querySvc *query.Service, tenantID, agentName string, lookback time.Duration) ([]promptinsights.ConversationExcerpt, error) {
	filterExpr := fmt.Sprintf("agent = %q", agentName)

	now := time.Now().UTC()
	searchReq := query.ConversationSearchRequest{
		Filters: filterExpr,
		TimeRange: query.ConversationSearchTimeRange{
			From: now.Add(-lookback),
			To:   now,
		},
		PageSize: promptInsightsConversationLimit,
	}

	searchResp, err := querySvc.SearchConversationsForTenant(ctx, tenantID, searchReq)
	if err != nil {
		return nil, fmt.Errorf("search conversations: %w", err)
	}

	excerpts := make([]promptinsights.ConversationExcerpt, 0, len(searchResp.Conversations))
	for _, conv := range searchResp.Conversations {
		detail, found, err := querySvc.GetConversationDetailForTenant(ctx, tenantID, conv.ConversationID)
		if err != nil || !found {
			continue
		}

		agentGens := make([]map[string]any, 0)
		for _, g := range detail.Generations {
			if an, _ := g["agent_name"].(string); an == agentName {
				agentGens = append(agentGens, g)
			}
		}

		if len(agentGens) == 0 {
			continue
		}

		excerpt := promptinsights.ConversationExcerpt{
			ConversationID:  conv.ConversationID,
			GenerationCount: len(agentGens),
			HasErrors:       conv.HasErrors,
		}

		firstGen := agentGens[0]
		excerpt.UserInput = extractFirstMessageText(firstGen, "input")
		excerpt.AssistantOutput = extractFirstMessageText(firstGen, "output")
		for _, g := range agentGens {
			excerpt.ToolCallCount += countToolCalls(g)
		}

		excerpts = append(excerpts, excerpt)
	}

	return excerpts, nil
}

func extractFirstMessageText(generation map[string]any, field string) string {
	messages, ok := generation[field].([]any)
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

func countToolCalls(generation map[string]any) int {
	output, ok := generation["output"].([]any)
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

func upsertPromptInsightsWithTimeout(
	store promptinsights.Store,
	tenantID string,
	agentName string,
	effectiveVersion string,
	insights promptinsights.PromptInsights,
) error {
	persistCtx, cancel := context.WithTimeout(context.Background(), promptInsightsPersistTimeout)
	defer cancel()
	return store.UpsertPromptInsights(persistCtx, tenantID, agentName, effectiveVersion, insights)
}

func lookupPromptInsights(querySvc *query.Service, insightsStore promptinsights.Store) http.HandlerFunc {
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

		rawNames, hasName := req.URL.Query()["name"]
		if !hasName {
			http.Error(w, "name query param is required", http.StatusBadRequest)
			return
		}

		agentName := ""
		if len(rawNames) > 0 {
			agentName = rawNames[0]
		}

		agentDetail, found, err := querySvc.GetAgentDetailForTenant(
			req.Context(),
			tenantID,
			agentName,
			req.URL.Query().Get("version"),
		)
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

		insights, err := insightsStore.GetPromptInsights(
			req.Context(),
			tenantID,
			agentDetail.AgentName,
			agentDetail.EffectiveVersion,
		)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if insights == nil {
			http.NotFound(w, req)
			return
		}
		insights.Status = promptinsights.NormalizeStatus(insights.Status)

		writeJSON(w, http.StatusOK, insights)
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

func parseGenerationDetailReadPlan(req *http.Request) (query.GenerationDetailReadPlan, error) {
	if req == nil {
		return query.GenerationDetailReadPlan{}, nil
	}
	values := req.URL.Query()
	plan := query.GenerationDetailReadPlan{
		ConversationID: strings.TrimSpace(values.Get("conversation_id")),
	}

	var err error
	if fromRaw := strings.TrimSpace(values.Get("from")); fromRaw != "" {
		plan.From, err = parseRFC3339Timestamp(fromRaw)
		if err != nil {
			return query.GenerationDetailReadPlan{}, errors.New("invalid from")
		}
	}
	if toRaw := strings.TrimSpace(values.Get("to")); toRaw != "" {
		plan.To, err = parseRFC3339Timestamp(toRaw)
		if err != nil {
			return query.GenerationDetailReadPlan{}, errors.New("invalid to")
		}
	}
	if atRaw := strings.TrimSpace(values.Get("at")); atRaw != "" {
		plan.At, err = parseRFC3339Timestamp(atRaw)
		if err != nil {
			return query.GenerationDetailReadPlan{}, errors.New("invalid at")
		}
	}

	if plan.From.IsZero() != plan.To.IsZero() {
		return query.GenerationDetailReadPlan{}, errors.New("from and to must be provided together")
	}
	if !plan.From.IsZero() && !plan.To.IsZero() && plan.To.Before(plan.From) {
		return query.GenerationDetailReadPlan{}, errors.New("from must be before to")
	}
	return plan, nil
}

func parseRFC3339Timestamp(raw string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Time{}, err
	}
	return parsed.UTC(), nil
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

func parseSingleConversationPath(path string, prefix string) (string, bool) {
	trimmed := strings.TrimPrefix(path, prefix)
	if trimmed == path || trimmed == "" || strings.Contains(trimmed, "/") {
		return "", false
	}
	return trimmed, true
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
