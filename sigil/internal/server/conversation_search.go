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
	"sort"
	"strings"
	"time"

	"github.com/grafana/dskit/tenant"
	"github.com/grafana/sigil/sigil/internal/query"
	"github.com/grafana/sigil/sigil/pkg/searchcore"
)

const conversationSearchMetadataChunkSize = 100

type conversationStatsResponse struct {
	TotalConversations      int     `json:"totalConversations"`
	TotalTokens             float64 `json:"totalTokens"`
	AvgCallsPerConversation float64 `json:"avgCallsPerConversation"`
	ActiveLast7d            int     `json:"activeLast7d"`
	RatedConversations      int     `json:"ratedConversations"`
	BadRatedPct             float64 `json:"badRatedPct"`
}

type conversationSearchStreamResultsEvent struct {
	Type          string                           `json:"type"`
	Conversations []query.ConversationSearchResult `json:"conversations"`
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

func searchConversations(querySvc *query.Service) http.HandlerFunc {
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

		payload, err := decodeConversationSearchRequest(req)
		if err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		response, err := runConversationSearch(req.Context(), querySvc, tenantID, payload, nil)
		if err != nil {
			slog.Error(
				"sigil conversation request failed",
				"endpoint", "/api/v1/conversations/search",
				"tenant_id", tenantID,
				"filters", strings.TrimSpace(payload.Filters),
				"page_size", payload.PageSize,
				"cursor_present", strings.TrimSpace(payload.Cursor) != "",
				"err", err.Error(),
			)
			writeConversationSearchError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	}
}

func streamSearchConversations(querySvc *query.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming is not supported", http.StatusInternalServerError)
			return
		}

		tenantID, err := tenant.TenantID(req.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		payload, err := decodeConversationSearchRequest(req)
		if err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		started := false
		response, err := runConversationSearch(req.Context(), querySvc, tenantID, payload, func(batch []query.ConversationSearchResult) error {
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
			slog.Error(
				"sigil conversation request failed",
				"endpoint", "/api/v1/conversations/search/stream",
				"tenant_id", tenantID,
				"filters", strings.TrimSpace(payload.Filters),
				"page_size", payload.PageSize,
				"cursor_present", strings.TrimSpace(payload.Cursor) != "",
				"err", err.Error(),
			)
			if !started {
				writeConversationSearchError(w, err)
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
		}
		_ = json.NewEncoder(w).Encode(conversationSearchStreamCompleteEvent{
			Type:       "complete",
			NextCursor: response.NextCursor,
			HasMore:    response.HasMore,
		})
		flusher.Flush()
	}
}

func conversationStats(querySvc *query.Service) http.HandlerFunc {
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

		payload, err := decodeConversationSearchRequest(req)
		if err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		stats, err := searchConversationStats(req.Context(), querySvc, tenantID, payload)
		if err != nil {
			slog.Error(
				"sigil conversation request failed",
				"endpoint", "/api/v1/conversations/stats",
				"tenant_id", tenantID,
				"filters", strings.TrimSpace(payload.Filters),
				"page_size", payload.PageSize,
				"cursor_present", strings.TrimSpace(payload.Cursor) != "",
				"err", err.Error(),
			)
			writeConversationSearchError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, stats)
	}
}

func runConversationSearch(
	ctx context.Context,
	querySvc *query.Service,
	tenantID string,
	request query.ConversationSearchRequest,
	emit func([]query.ConversationSearchResult) error,
) (query.ConversationSearchResponse, error) {
	parsedFilters, selectFields, from, to, cursor, filterHash, err := normalizeConversationSearchRequest(request)
	if err != nil {
		return query.ConversationSearchResponse{}, err
	}

	if canUseConversationProjectionFastPath(parsedFilters, selectFields) {
		return runConversationProjectionSearch(ctx, querySvc, tenantID, parsedFilters, selectFields, from, to, request.PageSize, cursor, filterHash, emit)
	}

	response, err := querySvc.SearchConversationsForTenant(ctx, tenantID, request)
	if err != nil {
		return query.ConversationSearchResponse{}, err
	}
	if emit != nil && len(response.Conversations) > 0 {
		if err := emit(response.Conversations); err != nil {
			return query.ConversationSearchResponse{}, err
		}
	}
	return response, nil
}

func searchConversationStats(
	ctx context.Context,
	querySvc *query.Service,
	tenantID string,
	request query.ConversationSearchRequest,
) (conversationStatsResponse, error) {
	parsedFilters, selectFields, from, to, _, _, err := normalizeConversationSearchRequest(request)
	if err != nil {
		return conversationStatsResponse{}, err
	}
	if canUseConversationProjectionFastPath(parsedFilters, selectFields) {
		// Stats intentionally use lifetime conversation token counters. Those
		// counters are ingest-time only today; we do not backfill legacy rows, so
		// upgraded deployments may undercount historical totalTokens.
		return searchConversationProjectionStats(ctx, querySvc, tenantID, parsedFilters, from, to)
	}

	stats := conversationStatsResponse{}
	totalCalls := 0
	badRatedConversations := 0
	statsRequest := request
	statsRequest.Select = []string{
		"span.gen_ai.usage.input_tokens",
		"span.gen_ai.usage.output_tokens",
		"span.gen_ai.usage.cache_read_input_tokens",
		"span.gen_ai.usage.cache_write_input_tokens",
		"span.gen_ai.usage.reasoning_tokens",
	}
	statsRequest.PageSize = searchcore.MaxConversationSearchPageSize
	statsRequest.Cursor = ""

	for pageIndex := 0; pageIndex < 1000; pageIndex++ {
		response, err := querySvc.SearchConversationsForTenant(ctx, tenantID, statsRequest)
		if err != nil {
			return conversationStatsResponse{}, err
		}
		pageCalls, pageBadRated := accumulateConversationStats(&stats, response.Conversations, to)
		totalCalls += pageCalls
		badRatedConversations += pageBadRated
		if !response.HasMore || strings.TrimSpace(response.NextCursor) == "" {
			break
		}
		statsRequest.Cursor = response.NextCursor
	}

	if stats.TotalConversations > 0 {
		stats.AvgCallsPerConversation = float64(totalCalls) / float64(stats.TotalConversations)
	}
	if stats.RatedConversations > 0 {
		stats.BadRatedPct = (float64(badRatedConversations) / float64(stats.RatedConversations)) * 100
	}
	return stats, nil
}

func runConversationProjectionSearch(
	ctx context.Context,
	querySvc *query.Service,
	tenantID string,
	parsedFilters query.ParsedFilters,
	selectFields []query.SelectField,
	from time.Time,
	to time.Time,
	requestedPageSize int,
	cursor searchcore.ConversationSearchCursor,
	filterHash string,
	emit func([]query.ConversationSearchResult) error,
) (query.ConversationSearchResponse, error) {
	pageSize := searchcore.NormalizeConversationSearchPageSize(requestedPageSize)
	seenConversationIDs := make(map[string]struct{}, len(cursor.ReturnedConversations))
	for _, conversationID := range cursor.ReturnedConversations {
		seenConversationIDs[conversationID] = struct{}{}
	}
	results := make([]query.ConversationSearchResult, 0, pageSize)
	hasMore := false
	for {
		page, pageHasMore, err := querySvc.ListConversationProjectionPageForTenant(
			ctx,
			tenantID,
			from,
			to,
			conversationSearchMetadataChunkSize,
			mapKeys(seenConversationIDs),
		)
		if err != nil {
			slog.Error(
				"sigil conversation request failed",
				"endpoint", "projection_search_page",
				"tenant_id", tenantID,
				"from_unix", from.UTC().Unix(),
				"to_unix", to.UTC().Unix(),
				"page_size", conversationSearchMetadataChunkSize,
				"seen_conversation_count", len(seenConversationIDs),
				"err", err.Error(),
			)
			return query.ConversationSearchResponse{}, err
		}
		if len(page) == 0 {
			break
		}

		batch := make([]query.ConversationSearchResult, 0, min(pageSize-len(results), len(page)))
		for _, metadata := range page {
			if !projectionConversationMatchesFilters(metadata, parsedFilters) {
				seenConversationIDs[metadata.ConversationID] = struct{}{}
				continue
			}
			if len(results) >= pageSize {
				hasMore = true
				break
			}
			seenConversationIDs[metadata.ConversationID] = struct{}{}

			result := query.ConversationSearchResult{
				ConversationID:    metadata.ConversationID,
				ConversationTitle: strings.TrimSpace(metadata.ConversationTitle),
				UserID:            strings.TrimSpace(metadata.UserID),
				GenerationCount:   metadata.GenerationCount,
				FirstGenerationAt: metadata.FirstGenerationAt.UTC(),
				LastGenerationAt:  metadata.LastGenerationAt.UTC(),
				Models:            append([]string{}, metadata.Models...),
				ModelProviders:    cloneStringMap(metadata.ModelProviders),
				Agents:            append([]string{}, metadata.Agents...),
				ErrorCount:        metadata.ErrorCount,
				HasErrors:         metadata.HasErrors,
				TraceIDs:          []string{},
				RatingSummary:     metadata.RatingSummary,
				AnnotationCount:   metadata.AnnotationCount,
				EvalSummary:       metadata.EvalSummary,
				Selected:          projectionSelectedFields(metadata, selectFields),
			}
			results = append(results, result)
			batch = append(batch, result)
		}

		if len(batch) > 0 && emit != nil {
			if err := emit(batch); err != nil {
				return query.ConversationSearchResponse{}, err
			}
		}
		if hasMore {
			break
		}
		if !pageHasMore {
			break
		}
	}

	nextCursor := ""
	if hasMore {
		encodedCursor, err := searchcore.EncodeConversationSearchCursor(searchcore.ConversationSearchCursor{
			EndNanos:              to.UnixNano(),
			ReturnedConversations: mapKeys(seenConversationIDs),
			FilterHash:            filterHash,
		})
		if err != nil {
			return query.ConversationSearchResponse{}, err
		}
		nextCursor = encodedCursor
	}

	return query.ConversationSearchResponse{
		Conversations: results,
		NextCursor:    nextCursor,
		HasMore:       hasMore,
	}, nil
}

func searchConversationProjectionStats(
	ctx context.Context,
	querySvc *query.Service,
	tenantID string,
	parsedFilters query.ParsedFilters,
	from time.Time,
	to time.Time,
) (conversationStatsResponse, error) {
	stats := conversationStatsResponse{}
	totalCalls := 0
	badRatedConversations := 0
	seenConversationIDs := map[string]struct{}{}
	for {
		page, hasMore, err := querySvc.ListConversationProjectionPageForTenant(
			ctx,
			tenantID,
			from,
			to,
			500,
			mapKeys(seenConversationIDs),
		)
		if err != nil {
			slog.Error(
				"sigil conversation request failed",
				"endpoint", "projection_stats_page",
				"tenant_id", tenantID,
				"from_unix", from.UTC().Unix(),
				"to_unix", to.UTC().Unix(),
				"page_size", 500,
				"seen_conversation_count", len(seenConversationIDs),
				"err", err.Error(),
			)
			return conversationStatsResponse{}, err
		}
		if len(page) == 0 {
			break
		}
		for _, metadata := range page {
			seenConversationIDs[metadata.ConversationID] = struct{}{}
			if !projectionConversationMatchesFilters(metadata, parsedFilters) {
				continue
			}
			stats.TotalConversations++
			totalCalls += metadata.GenerationCount
			stats.TotalTokens += float64(metadata.TotalTokens)

			lastActivity := metadata.LastGenerationAt.UTC()
			age := to.Sub(lastActivity)
			if !lastActivity.IsZero() && age >= 0 && age <= 7*24*time.Hour {
				stats.ActiveLast7d++
			}
			if metadata.RatingSummary != nil && metadata.RatingSummary.TotalCount > 0 {
				stats.RatedConversations++
				if metadata.RatingSummary.HasBadRating {
					badRatedConversations++
				}
			}
		}
		if !hasMore {
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

func decodeConversationSearchRequest(req *http.Request) (query.ConversationSearchRequest, error) {
	var payload query.ConversationSearchRequest
	if req.Body == nil {
		return payload, nil
	}

	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
		return query.ConversationSearchRequest{}, err
	}
	return payload, nil
}

func normalizeConversationSearchRequest(
	request query.ConversationSearchRequest,
) (query.ParsedFilters, []query.SelectField, time.Time, time.Time, searchcore.ConversationSearchCursor, string, error) {
	from, to, err := normalizeConversationSearchTimeRange(request.TimeRange)
	if err != nil {
		return query.ParsedFilters{}, nil, time.Time{}, time.Time{}, searchcore.ConversationSearchCursor{}, "", err
	}
	parsedFilters, err := query.ParseFilterExpression(request.Filters)
	if err != nil {
		return query.ParsedFilters{}, nil, time.Time{}, time.Time{}, searchcore.ConversationSearchCursor{}, "", query.NewValidationError(err.Error())
	}
	if err := searchcore.ValidateMySQLFilterTerms(parsedFilters.MySQLTerms); err != nil {
		return query.ParsedFilters{}, nil, time.Time{}, time.Time{}, searchcore.ConversationSearchCursor{}, "", query.NewValidationError(err.Error())
	}
	if err := validateProjectionTempoTerms(parsedFilters.TempoTerms); err != nil {
		return query.ParsedFilters{}, nil, time.Time{}, time.Time{}, searchcore.ConversationSearchCursor{}, "", query.NewValidationError(err.Error())
	}
	selectFields, err := query.NormalizeSelectFields(request.Select)
	if err != nil {
		return query.ParsedFilters{}, nil, time.Time{}, time.Time{}, searchcore.ConversationSearchCursor{}, "", query.NewValidationError(err.Error())
	}
	filterHash := searchcore.BuildConversationSearchFilterHash(parsedFilters, selectFields, from, to)
	cursor, err := searchcore.DecodeConversationSearchCursor(request.Cursor)
	if err != nil {
		return query.ParsedFilters{}, nil, time.Time{}, time.Time{}, searchcore.ConversationSearchCursor{}, "", query.NewValidationError("invalid cursor")
	}
	if strings.TrimSpace(request.Cursor) != "" && cursor.FilterHash != filterHash {
		return query.ParsedFilters{}, nil, time.Time{}, time.Time{}, searchcore.ConversationSearchCursor{}, "", query.NewValidationError("cursor no longer matches current filters")
	}
	return parsedFilters, selectFields, from, to, cursor, filterHash, nil
}

func validateProjectionTempoTerms(terms []query.FilterTerm) error {
	for _, term := range terms {
		if term.Operator != query.FilterOperatorRegex {
			continue
		}
		switch strings.TrimSpace(term.RawKey) {
		case "model", "provider", "agent":
			if _, err := regexp.Compile(strings.TrimSpace(term.Value)); err != nil {
				return fmt.Errorf("invalid regex for %s: %w", strings.TrimSpace(term.RawKey), err)
			}
		}
	}
	return nil
}

func normalizeConversationSearchTimeRange(timeRange query.ConversationSearchTimeRange) (time.Time, time.Time, error) {
	from := timeRange.From.UTC()
	to := timeRange.To.UTC()
	if from.IsZero() || to.IsZero() {
		return time.Time{}, time.Time{}, query.NewValidationError("time_range.from and time_range.to are required")
	}
	if !from.Before(to) {
		return time.Time{}, time.Time{}, query.NewValidationError("time_range.from must be before time_range.to")
	}
	return from, to, nil
}

func prepareConversationSearchStreamResponse(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
}

func writeConversationSearchError(w http.ResponseWriter, err error) {
	if err == nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if query.IsValidationError(err) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	http.Error(w, "internal server error", http.StatusInternalServerError)
}

func accumulateConversationStats(
	stats *conversationStatsResponse,
	conversations []query.ConversationSearchResult,
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
		stats.TotalTokens += selectedNumber(conversation.Selected, "span.gen_ai.usage.input_tokens")
		stats.TotalTokens += selectedNumber(conversation.Selected, "span.gen_ai.usage.output_tokens")
		stats.TotalTokens += selectedNumber(conversation.Selected, "span.gen_ai.usage.cache_read_input_tokens")
		stats.TotalTokens += selectedNumber(conversation.Selected, "span.gen_ai.usage.cache_write_input_tokens")
		stats.TotalTokens += selectedNumber(conversation.Selected, "span.gen_ai.usage.reasoning_tokens")

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

func selectedNumber(selected map[string]any, key string) float64 {
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

func canUseConversationProjectionFastPath(parsedFilters query.ParsedFilters, selectFields []query.SelectField) bool {
	for _, term := range parsedFilters.TempoTerms {
		if !projectionSupportsTempoTerm(term) {
			return false
		}
	}
	for _, field := range selectFields {
		if !projectionSupportsSelectField(field) {
			return false
		}
	}
	return true
}

func projectionConversationMatchesFilters(metadata query.ConversationBatchMetadata, parsedFilters query.ParsedFilters) bool {
	if !searchcore.MatchesGenerationCountFilters(metadata.GenerationCount, parsedFilters.MySQLTerms) {
		return false
	}
	for _, term := range parsedFilters.TempoTerms {
		if !projectionTempoTermMatches(metadata, term) {
			return false
		}
	}
	return true
}

func projectionSupportsTempoTerm(term query.FilterTerm) bool {
	switch strings.TrimSpace(term.RawKey) {
	case "model", "provider", "agent":
		switch term.Operator {
		case query.FilterOperatorEqual, query.FilterOperatorNotEqual, query.FilterOperatorRegex:
			return strings.TrimSpace(term.Value) != ""
		default:
			return false
		}
	case "status":
		return term.Operator == query.FilterOperatorEqual && strings.EqualFold(strings.TrimSpace(term.Value), "error")
	default:
		return false
	}
}

func projectionSupportsSelectField(field query.SelectField) bool {
	switch strings.TrimSpace(field.ResolvedKey) {
	case "span.gen_ai.usage.input_tokens",
		"span.gen_ai.usage.output_tokens",
		"span.gen_ai.usage.cache_read_input_tokens",
		"span.gen_ai.usage.cache_write_input_tokens",
		"span.gen_ai.usage.reasoning_tokens":
		return true
	default:
		return false
	}
}

func projectionTempoTermMatches(metadata query.ConversationBatchMetadata, term query.FilterTerm) bool {
	switch strings.TrimSpace(term.RawKey) {
	case "model":
		return projectionStringSliceMatches(metadata.Models, term)
	case "provider":
		return projectionStringSliceMatches(projectionProviderValues(metadata.ModelProviders), term)
	case "agent":
		return projectionStringSliceMatches(metadata.Agents, term)
	case "status":
		return metadata.ErrorCount > 0 && strings.EqualFold(strings.TrimSpace(term.Value), "error")
	default:
		return false
	}
}

func projectionStringSliceMatches(values []string, term query.FilterTerm) bool {
	if len(values) == 0 {
		return term.Operator == query.FilterOperatorNotEqual
	}

	target := strings.TrimSpace(term.Value)
	switch term.Operator {
	case query.FilterOperatorEqual:
		for _, value := range values {
			if value == target {
				return true
			}
		}
		return false
	case query.FilterOperatorNotEqual:
		// Projection filters are evaluated against the full conversation summary,
		// not individual matching generations. `!=` therefore means the target is
		// absent from the lifetime summary entirely.
		for _, value := range values {
			if value == target {
				return false
			}
		}
		return true
	case query.FilterOperatorRegex:
		pattern, err := regexp.Compile(target)
		if err != nil {
			return false
		}
		for _, value := range values {
			if pattern.MatchString(value) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

func projectionProviderValues(modelProviders map[string]string) []string {
	if len(modelProviders) == 0 {
		return []string{}
	}
	values := make([]string, 0, len(modelProviders))
	seen := make(map[string]struct{}, len(modelProviders))
	for _, provider := range modelProviders {
		normalized := strings.TrimSpace(provider)
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		values = append(values, normalized)
	}
	sort.Strings(values)
	return values
}

func mapKeys(values map[string]struct{}) []string {
	if len(values) == 0 {
		return nil
	}
	keys := make([]string, 0, len(values))
	for value := range values {
		keys = append(keys, value)
	}
	sort.Strings(keys)
	return keys
}

func projectionSelectedFields(metadata query.ConversationBatchMetadata, selectFields []query.SelectField) map[string]any {
	if len(selectFields) == 0 {
		return nil
	}

	selected := make(map[string]any, len(selectFields))
	for _, field := range selectFields {
		switch strings.TrimSpace(field.ResolvedKey) {
		case "span.gen_ai.usage.input_tokens":
			selected[field.Key] = float64(metadata.InputTokens)
		case "span.gen_ai.usage.output_tokens":
			selected[field.Key] = float64(metadata.OutputTokens)
		case "span.gen_ai.usage.cache_read_input_tokens":
			selected[field.Key] = float64(metadata.CacheReadTokens)
		case "span.gen_ai.usage.cache_write_input_tokens":
			selected[field.Key] = float64(metadata.CacheWriteTokens)
		case "span.gen_ai.usage.reasoning_tokens":
			selected[field.Key] = float64(metadata.ReasoningTokens)
		}
	}
	if len(selected) == 0 {
		return nil
	}
	return selected
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}
