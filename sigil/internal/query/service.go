package query

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/feedback"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"google.golang.org/protobuf/encoding/protojson"
)

type Conversation struct {
	ID                string                                  `json:"id"`
	Title             string                                  `json:"title,omitempty"`
	LastGenerationAt  time.Time                               `json:"last_generation_at"`
	GenerationCount   int                                     `json:"generation_count"`
	CreatedAt         time.Time                               `json:"created_at"`
	UpdatedAt         time.Time                               `json:"updated_at"`
	RatingSummary     *feedback.ConversationRatingSummary     `json:"rating_summary,omitempty"`
	AnnotationSummary *feedback.ConversationAnnotationSummary `json:"annotation_summary,omitempty"`
}

type ConversationListFilter struct {
	HasBadRating   *bool
	HasAnnotations *bool
}

type ConversationSearchTimeRange struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

type ConversationSearchRequest struct {
	Filters   string                      `json:"filters"`
	Select    []string                    `json:"select"`
	TimeRange ConversationSearchTimeRange `json:"time_range"`
	PageSize  int                         `json:"page_size"`
	Cursor    string                      `json:"cursor"`
}

type ConversationSearchResult struct {
	ConversationID    string                              `json:"conversation_id"`
	GenerationCount   int                                 `json:"generation_count"`
	FirstGenerationAt time.Time                           `json:"first_generation_at"`
	LastGenerationAt  time.Time                           `json:"last_generation_at"`
	Models            []string                            `json:"models"`
	Agents            []string                            `json:"agents"`
	ErrorCount        int                                 `json:"error_count"`
	HasErrors         bool                                `json:"has_errors"`
	TraceIDs          []string                            `json:"trace_ids"`
	RatingSummary     *feedback.ConversationRatingSummary `json:"rating_summary,omitempty"`
	AnnotationCount   int                                 `json:"annotation_count"`
	EvalSummary       *evalpkg.ConversationEvalSummary    `json:"eval_summary,omitempty"`
	Selected          map[string]any                      `json:"selected,omitempty"`
}

type ConversationSearchResponse struct {
	Conversations []ConversationSearchResult `json:"conversations"`
	NextCursor    string                     `json:"next_cursor"`
	HasMore       bool                       `json:"has_more"`
}

type ConversationDetail struct {
	ConversationID    string                              `json:"conversation_id"`
	GenerationCount   int                                 `json:"generation_count"`
	FirstGenerationAt time.Time                           `json:"first_generation_at"`
	LastGenerationAt  time.Time                           `json:"last_generation_at"`
	Generations       []map[string]any                    `json:"generations"`
	RatingSummary     *feedback.ConversationRatingSummary `json:"rating_summary,omitempty"`
	Annotations       []feedback.ConversationAnnotation   `json:"annotations"`
}

type ValidationError struct {
	msg string
}

func (e *ValidationError) Error() string {
	return e.msg
}

func NewValidationError(msg string) error {
	return &ValidationError{msg: msg}
}

func IsValidationError(err error) bool {
	var validationErr *ValidationError
	return errors.As(err, &validationErr)
}

type ratingSummaryStore interface {
	GetConversationRatingSummary(ctx context.Context, tenantID, conversationID string) (*feedback.ConversationRatingSummary, error)
	ListConversationRatingSummaries(ctx context.Context, tenantID string, conversationIDs []string) (map[string]feedback.ConversationRatingSummary, error)
}

type annotationSummaryStore interface {
	GetConversationAnnotationSummary(ctx context.Context, tenantID, conversationID string) (*feedback.ConversationAnnotationSummary, error)
	ListConversationAnnotationSummaries(ctx context.Context, tenantID string, conversationIDs []string) (map[string]feedback.ConversationAnnotationSummary, error)
}

type annotationEventStore interface {
	ListConversationAnnotations(ctx context.Context, tenantID, conversationID string, limit int, cursor uint64) ([]feedback.ConversationAnnotation, uint64, error)
}

type scoreStore interface {
	GetScoresByGeneration(ctx context.Context, tenantID, generationID string, limit int, cursor uint64) ([]evalpkg.GenerationScore, uint64, error)
	GetLatestScoresByGeneration(ctx context.Context, tenantID, generationID string) (map[string]evalpkg.LatestScore, error)
	GetLatestScoresByConversation(ctx context.Context, tenantID, conversationID string) (map[string]map[string]evalpkg.LatestScore, error)
}

type evalSummaryStore interface {
	ListConversationEvalSummaries(ctx context.Context, tenantID string, conversationIDs []string) (map[string]evalpkg.ConversationEvalSummary, error)
}

type filteredConversationStore interface {
	ListConversationsWithFeedbackFilters(ctx context.Context, tenantID string, hasBadRating, hasAnnotations *bool) ([]storage.Conversation, error)
}

type ServiceDependencies struct {
	ConversationStore   storage.ConversationStore
	WALReader           storage.WALReader
	BlockMetadataStore  storage.BlockMetadataStore
	BlockReader         storage.BlockReader
	FanOutStore         storage.GenerationFanOutReader
	FeedbackStore       feedback.Store
	ScoreStore          scoreStore
	EvalSummaryStore    evalSummaryStore
	TempoBaseURL        string
	HTTPClient          *http.Client
	OverfetchMultiplier int
	MaxSearchIterations int
}

type Service struct {
	conversationStore      storage.ConversationStore
	walReader              storage.WALReader
	fanOutStore            storage.GenerationFanOutReader
	ratingSummaryStore     ratingSummaryStore
	annotationSummaryStore annotationSummaryStore
	annotationEventStore   annotationEventStore
	scoreStore             scoreStore
	evalSummaryStore       evalSummaryStore
	tempoClient            TempoClient
	nowFn                  func() time.Time
	overfetchMultiplier    int
	maxSearchIterations    int
	queryDebug             bool
}

func NewService() *Service {
	return &Service{
		nowFn:               time.Now,
		overfetchMultiplier: defaultTempoOverfetchMultiplier,
		maxSearchIterations: defaultTempoSearchMaxIterations,
		queryDebug:          queryDebugEnabledFromEnv(),
	}
}

func NewServiceWithStores(conversationStore storage.ConversationStore, feedbackStore feedback.Store) *Service {
	service := NewService()
	service.conversationStore = conversationStore

	var blockMetadataStore storage.BlockMetadataStore
	if reader, ok := conversationStore.(storage.WALReader); ok {
		service.walReader = reader
	}
	if store, ok := conversationStore.(scoreStore); ok {
		service.scoreStore = store
	}
	if store, ok := conversationStore.(evalSummaryStore); ok {
		service.evalSummaryStore = store
	}
	if metadataStore, ok := conversationStore.(storage.BlockMetadataStore); ok {
		blockMetadataStore = metadataStore
	}
	service.fanOutStore = storage.NewFanOutStore(service.walReader, blockMetadataStore, nil)
	service.attachFeedbackStore(feedbackStore)
	return service
}

func NewServiceWithDependencies(dependencies ServiceDependencies) (*Service, error) {
	service := NewServiceWithStores(dependencies.ConversationStore, dependencies.FeedbackStore)

	var blockMetadataStore storage.BlockMetadataStore
	if metadataStore, ok := dependencies.ConversationStore.(storage.BlockMetadataStore); ok {
		blockMetadataStore = metadataStore
	}

	if dependencies.WALReader != nil {
		service.walReader = dependencies.WALReader
		if store, ok := dependencies.WALReader.(scoreStore); ok {
			service.scoreStore = store
		}
		if store, ok := dependencies.WALReader.(evalSummaryStore); ok {
			service.evalSummaryStore = store
		}
	}
	if dependencies.BlockMetadataStore != nil {
		blockMetadataStore = dependencies.BlockMetadataStore
	}
	if dependencies.ScoreStore != nil {
		service.scoreStore = dependencies.ScoreStore
	}
	if dependencies.EvalSummaryStore != nil {
		service.evalSummaryStore = dependencies.EvalSummaryStore
	}
	if dependencies.FanOutStore != nil {
		service.fanOutStore = dependencies.FanOutStore
	} else {
		service.fanOutStore = storage.NewFanOutStore(service.walReader, blockMetadataStore, dependencies.BlockReader)
	}

	if dependencies.OverfetchMultiplier > 0 {
		service.overfetchMultiplier = dependencies.OverfetchMultiplier
	}
	if dependencies.MaxSearchIterations > 0 {
		service.maxSearchIterations = dependencies.MaxSearchIterations
	}

	if strings.TrimSpace(dependencies.TempoBaseURL) != "" {
		tempoClient, err := NewTempoHTTPClient(dependencies.TempoBaseURL, dependencies.HTTPClient)
		if err != nil {
			return nil, err
		}
		service.tempoClient = tempoClient
	}

	return service, nil
}

func (s *Service) attachFeedbackStore(feedbackStore feedback.Store) {
	if store, ok := feedbackStore.(ratingSummaryStore); ok {
		s.ratingSummaryStore = store
	}
	if store, ok := feedbackStore.(annotationSummaryStore); ok {
		s.annotationSummaryStore = store
	}
	if store, ok := feedbackStore.(annotationEventStore); ok {
		s.annotationEventStore = store
	}
}

func (s *Service) SetTempoClient(client TempoClient) {
	if s == nil {
		return
	}
	s.tempoClient = client
}

func queryDebugEnabledFromEnv() bool {
	raw := strings.TrimSpace(os.Getenv("SIGIL_QUERY_DEBUG"))
	if raw == "" {
		return false
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return false
	}
	return enabled
}

func (s *Service) debugLog(event string, keyvals ...any) {
	if !s.queryDebug {
		return
	}
	payload := make([]any, 0, len(keyvals)+2)
	payload = append(payload, "event", event)
	payload = append(payload, keyvals...)
	slog.Info("sigil query debug", payload...)
}

func (s *Service) ListConversationsForTenant(ctx context.Context, tenantID string, filter ConversationListFilter) ([]Conversation, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if s.conversationStore == nil || trimmedTenantID == "" {
		return s.bootstrapConversations(), nil
	}

	var (
		rows       []storage.Conversation
		err        error
		filteredDB bool
	)
	if filteredStore, ok := s.conversationStore.(filteredConversationStore); ok {
		rows, err = filteredStore.ListConversationsWithFeedbackFilters(ctx, trimmedTenantID, filter.HasBadRating, filter.HasAnnotations)
		filteredDB = true
	} else {
		rows, err = s.conversationStore.ListConversations(ctx, trimmedTenantID)
	}
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []Conversation{}, nil
	}

	conversationIDs := make([]string, 0, len(rows))
	items := make([]Conversation, 0, len(rows))
	for _, row := range rows {
		items = append(items, toConversation(row))
		conversationIDs = append(conversationIDs, row.ConversationID)
	}

	if s.ratingSummaryStore != nil {
		ratingSummaries, err := s.ratingSummaryStore.ListConversationRatingSummaries(ctx, trimmedTenantID, conversationIDs)
		if err != nil {
			return nil, err
		}
		for idx := range items {
			summary, ok := ratingSummaries[items[idx].ID]
			if !ok {
				continue
			}
			copied := summary
			items[idx].RatingSummary = &copied
		}
	}

	if s.annotationSummaryStore != nil {
		annotationSummaries, err := s.annotationSummaryStore.ListConversationAnnotationSummaries(ctx, trimmedTenantID, conversationIDs)
		if err != nil {
			return nil, err
		}
		for idx := range items {
			summary, ok := annotationSummaries[items[idx].ID]
			if !ok {
				continue
			}
			copied := summary
			items[idx].AnnotationSummary = &copied
		}
	}

	if !filteredDB && (filter.HasBadRating != nil || filter.HasAnnotations != nil) {
		filtered := make([]Conversation, 0, len(items))
		for _, item := range items {
			if !matchesConversationFilter(item, filter) {
				continue
			}
			filtered = append(filtered, item)
		}
		return filtered, nil
	}

	return items, nil
}

func (s *Service) GetConversationForTenant(ctx context.Context, tenantID, id string) (Conversation, bool, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedConversationID := strings.TrimSpace(id)
	if trimmedConversationID == "" {
		return Conversation{}, false, nil
	}
	if s.conversationStore == nil || trimmedTenantID == "" {
		return s.bootstrapConversation(trimmedConversationID), true, nil
	}

	row, err := s.conversationStore.GetConversation(ctx, trimmedTenantID, trimmedConversationID)
	if err != nil {
		return Conversation{}, false, err
	}
	if row == nil {
		return Conversation{}, false, nil
	}

	out := toConversation(*row)
	if s.ratingSummaryStore != nil {
		summary, err := s.ratingSummaryStore.GetConversationRatingSummary(ctx, trimmedTenantID, trimmedConversationID)
		if err != nil {
			return Conversation{}, false, err
		}
		if summary != nil {
			copied := *summary
			out.RatingSummary = &copied
		}
	}
	if s.annotationSummaryStore != nil {
		summary, err := s.annotationSummaryStore.GetConversationAnnotationSummary(ctx, trimmedTenantID, trimmedConversationID)
		if err != nil {
			return Conversation{}, false, err
		}
		if summary != nil {
			copied := *summary
			out.AnnotationSummary = &copied
		}
	}

	return out, true, nil
}

func (s *Service) SearchConversationsForTenant(ctx context.Context, tenantID string, request ConversationSearchRequest) (ConversationSearchResponse, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return ConversationSearchResponse{}, NewValidationError("tenant id is required")
	}
	if s.tempoClient == nil {
		return ConversationSearchResponse{}, errors.New("tempo client is not configured")
	}
	if s.conversationStore == nil {
		return ConversationSearchResponse{}, errors.New("conversation store is not configured")
	}
	s.debugLog("search_start",
		"tenant_id", trimmedTenantID,
		"filters", strings.TrimSpace(request.Filters),
		"select_count", len(request.Select),
		"requested_page_size", request.PageSize,
		"cursor_present", strings.TrimSpace(request.Cursor) != "",
	)

	from, to, err := normalizeConversationSearchTimeRange(request.TimeRange)
	if err != nil {
		return ConversationSearchResponse{}, err
	}

	parsedFilters, err := ParseFilterExpression(request.Filters)
	if err != nil {
		return ConversationSearchResponse{}, NewValidationError(err.Error())
	}
	if err := validateMySQLFilterTerms(parsedFilters.MySQLTerms); err != nil {
		return ConversationSearchResponse{}, err
	}

	selectFields, err := NormalizeSelectFields(request.Select)
	if err != nil {
		return ConversationSearchResponse{}, NewValidationError(err.Error())
	}

	pageSize := normalizeConversationSearchPageSize(request.PageSize)
	overfetchLimit := pageSize * s.overfetchMultiplier
	if overfetchLimit < pageSize {
		overfetchLimit = pageSize
	}

	filterHash := buildConversationSearchFilterHash(parsedFilters, selectFields, from, to)
	cursor, err := decodeConversationSearchCursor(request.Cursor)
	if err != nil {
		return ConversationSearchResponse{}, NewValidationError("invalid cursor")
	}
	if strings.TrimSpace(request.Cursor) != "" && cursor.FilterHash != filterHash {
		return ConversationSearchResponse{}, NewValidationError("cursor no longer matches current filters")
	}

	traceQL, err := BuildTraceQL(parsedFilters, selectFields)
	if err != nil {
		return ConversationSearchResponse{}, NewValidationError(err.Error())
	}

	searchEndNanos := to.UnixNano()
	if cursor.EndNanos > 0 && cursor.EndNanos < searchEndNanos {
		searchEndNanos = cursor.EndNanos
	}
	if searchEndNanos <= from.UnixNano() {
		s.debugLog("search_short_circuit_empty_range",
			"from_unix_nano", from.UnixNano(),
			"search_end_unix_nano", searchEndNanos,
		)
		return ConversationSearchResponse{Conversations: []ConversationSearchResult{}, HasMore: false}, nil
	}

	alreadyReturned := make(map[string]struct{}, len(cursor.ReturnedConversations))
	for _, conversationID := range cursor.ReturnedConversations {
		alreadyReturned[conversationID] = struct{}{}
	}
	currentPageIDs := make(map[string]struct{}, pageSize)

	results := make([]ConversationSearchResult, 0, pageSize)
	hasMore := false
	terminatedByIterationLimit := s.maxSearchIterations > 0

	s.debugLog("search_plan",
		"time_from_unix", from.Unix(),
		"time_to_unix", to.Unix(),
		"tempo_terms", len(parsedFilters.TempoTerms),
		"mysql_terms", len(parsedFilters.MySQLTerms),
		"normalized_page_size", pageSize,
		"overfetch_limit", overfetchLimit,
		"max_iterations", s.maxSearchIterations,
		"already_returned_count", len(alreadyReturned),
		"traceql", traceQL,
	)

	// Tempo paginates by time-window rather than cursor token. We overfetch traces in each
	// window and group/dedupe to conversations. Once the current page is full, we continue
	// scanning until we can prove at least one additional eligible conversation exists.
	// We only emit has_more/cursor when that proof exists to avoid empty follow-up pages.
	for iteration := 0; iteration < s.maxSearchIterations; iteration++ {
		windowEnd := time.Unix(0, searchEndNanos).UTC()
		s.debugLog("search_iteration_begin",
			"iteration", iteration,
			"window_end_unix", windowEnd.Unix(),
			"search_end_unix_nano", searchEndNanos,
			"results_so_far", len(results),
		)
		if !from.Before(windowEnd) {
			terminatedByIterationLimit = false
			s.debugLog("search_iteration_stop", "iteration", iteration, "reason", "window_exhausted")
			break
		}

		tempoResponse, err := s.tempoClient.Search(ctx, TempoSearchRequest{
			TenantID:        trimmedTenantID,
			Query:           traceQL,
			Limit:           overfetchLimit,
			Start:           from,
			End:             windowEnd,
			SpansPerSpanSet: defaultTempoSearchSpansPerSpanSet,
		})
		if err != nil {
			return ConversationSearchResponse{}, err
		}
		s.debugLog("search_iteration_tempo_response",
			"iteration", iteration,
			"trace_count", len(tempoResponse.Traces),
		)
		if len(tempoResponse.Traces) == 0 {
			terminatedByIterationLimit = false
			s.debugLog("search_iteration_stop", "iteration", iteration, "reason", "tempo_empty")
			break
		}

		grouped := groupTempoSearchResponse(tempoResponse, selectFields)
		orderedConversationIDs := orderTempoConversationIDs(grouped.Conversations)
		s.debugLog("search_iteration_grouped",
			"iteration", iteration,
			"grouped_conversations", len(grouped.Conversations),
			"ordered_conversations", len(orderedConversationIDs),
			"earliest_trace_start_unix_nano", grouped.EarliestTraceStartNanos,
		)

		metadataByConversation, ratingSummaries, annotationSummaries, evalSummaries, err := s.loadConversationSearchMetadata(ctx, trimmedTenantID, orderedConversationIDs)
		if err != nil {
			return ConversationSearchResponse{}, err
		}
		s.debugLog("search_iteration_metadata",
			"iteration", iteration,
			"metadata_conversations", len(metadataByConversation),
			"rating_summaries", len(ratingSummaries),
			"annotation_summaries", len(annotationSummaries),
		)

		foundAdditionalConversation := false
		skippedAlreadyReturned := 0
		skippedCurrentPage := 0
		skippedMissingMetadata := 0
		skippedMySQL := 0
		addedThisIteration := 0
		for _, conversationID := range orderedConversationIDs {
			if _, seen := alreadyReturned[conversationID]; seen {
				skippedAlreadyReturned++
				continue
			}
			if _, seen := currentPageIDs[conversationID]; seen {
				skippedCurrentPage++
				continue
			}

			conversationMetadata, ok := metadataByConversation[conversationID]
			if !ok {
				skippedMissingMetadata++
				continue
			}
			if !matchesMySQLFilters(conversationMetadata, parsedFilters.MySQLTerms) {
				skippedMySQL++
				continue
			}

			if len(results) >= pageSize {
				foundAdditionalConversation = true
				break
			}

			aggregate := grouped.Conversations[conversationID]
			result := ConversationSearchResult{
				ConversationID:    conversationID,
				GenerationCount:   conversationMetadata.GenerationCount,
				FirstGenerationAt: conversationMetadata.CreatedAt.UTC(),
				LastGenerationAt:  conversationMetadata.LastGenerationAt.UTC(),
				Models:            sortedKeysFromSet(aggregate.Models),
				Agents:            sortedKeysFromSet(aggregate.Agents),
				ErrorCount:        aggregate.ErrorCount,
				HasErrors:         aggregate.ErrorCount > 0,
				TraceIDs:          sortedKeysFromSet(aggregate.TraceIDs),
				AnnotationCount:   annotationSummaries[conversationID].AnnotationCount,
			}
			if ratingSummary, ok := ratingSummaries[conversationID]; ok {
				copied := ratingSummary
				result.RatingSummary = &copied
			}
			if evalSummary, ok := evalSummaries[conversationID]; ok {
				copied := evalSummary
				result.EvalSummary = &copied
			}
			result.Selected = buildSelectedResultMap(aggregate.Selected)

			results = append(results, result)
			currentPageIDs[conversationID] = struct{}{}
			addedThisIteration++
		}
		s.debugLog("search_iteration_candidates_applied",
			"iteration", iteration,
			"added_this_iteration", addedThisIteration,
			"results_total", len(results),
			"skipped_already_returned", skippedAlreadyReturned,
			"skipped_current_page", skippedCurrentPage,
			"skipped_missing_metadata", skippedMissingMetadata,
			"skipped_mysql_filter", skippedMySQL,
			"found_additional", foundAdditionalConversation,
		)

		if foundAdditionalConversation {
			// Keep the current window bound so the next page can replay this window and
			// continue from the extra conversation while skipping already returned IDs.
			hasMore = true
			terminatedByIterationLimit = false
			s.debugLog("search_iteration_stop", "iteration", iteration, "reason", "found_additional_conversation")
			break
		}

		if grouped.EarliestTraceStartNanos <= 0 || grouped.EarliestTraceStartNanos <= from.UnixNano() {
			terminatedByIterationLimit = false
			s.debugLog("search_iteration_stop",
				"iteration", iteration,
				"reason", "earliest_trace_reached_start",
				"earliest_trace_start_unix_nano", grouped.EarliestTraceStartNanos,
				"range_start_unix_nano", from.UnixNano(),
			)
			break
		}
		if len(tempoResponse.Traces) < overfetchLimit {
			terminatedByIterationLimit = false
			s.debugLog("search_iteration_stop",
				"iteration", iteration,
				"reason", "tempo_under_overfetch_limit",
				"trace_count", len(tempoResponse.Traces),
				"overfetch_limit", overfetchLimit,
			)
			break
		}

		searchEndNanos = grouped.EarliestTraceStartNanos - 1
		s.debugLog("search_iteration_continue",
			"iteration", iteration,
			"next_search_end_unix_nano", searchEndNanos,
		)
	}

	if terminatedByIterationLimit && !hasMore && searchEndNanos > from.UnixNano() {
		// We reached the configured iteration cap before proving the range is exhausted.
		// Preserve a continuation cursor so clients can keep paging older windows.
		hasMore = true
		s.debugLog("search_iteration_limit_reached",
			"search_end_unix_nano", searchEndNanos,
			"range_start_unix_nano", from.UnixNano(),
			"results_total", len(results),
		)
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
		nextCursor, err = encodeConversationSearchCursor(conversationSearchCursor{
			EndNanos:              searchEndNanos,
			ReturnedConversations: returnedConversations,
			FilterHash:            filterHash,
		})
		if err != nil {
			return ConversationSearchResponse{}, err
		}
	}

	if results == nil {
		results = []ConversationSearchResult{}
	}
	s.debugLog("search_done",
		"results_count", len(results),
		"has_more", hasMore,
		"next_cursor_present", nextCursor != "",
	)
	return ConversationSearchResponse{
		Conversations: results,
		NextCursor:    nextCursor,
		HasMore:       hasMore,
	}, nil
}

func (s *Service) GetConversationDetailForTenant(ctx context.Context, tenantID, conversationID string) (ConversationDetail, bool, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedConversationID := strings.TrimSpace(conversationID)
	if trimmedTenantID == "" {
		return ConversationDetail{}, false, NewValidationError("tenant id is required")
	}
	if trimmedConversationID == "" {
		return ConversationDetail{}, false, NewValidationError("conversation id is required")
	}
	if s.conversationStore == nil {
		return ConversationDetail{}, false, errors.New("conversation store is not configured")
	}
	if s.walReader == nil {
		return ConversationDetail{}, false, errors.New("wal reader is not configured")
	}
	fanOutStore := s.fanOutStore
	if fanOutStore == nil {
		fanOutStore = storage.NewFanOutStore(s.walReader, nil, nil)
	}

	conversation, err := s.conversationStore.GetConversation(ctx, trimmedTenantID, trimmedConversationID)
	if err != nil {
		return ConversationDetail{}, false, err
	}
	if conversation == nil {
		return ConversationDetail{}, false, nil
	}

	mergedGenerations, err := fanOutStore.ListConversationGenerations(ctx, trimmedTenantID, trimmedConversationID)
	if err != nil {
		return ConversationDetail{}, false, err
	}

	generationPayloads := make([]map[string]any, 0, len(mergedGenerations))
	for _, generation := range mergedGenerations {
		payload, err := generationToResponsePayload(generation)
		if err != nil {
			return ConversationDetail{}, false, err
		}
		generationPayloads = append(generationPayloads, payload)
	}

	if s.scoreStore != nil {
		scoresByGen, err := s.scoreStore.GetLatestScoresByConversation(ctx, trimmedTenantID, trimmedConversationID)
		if err != nil {
			s.debugLog("conversation_scores_enrichment_failed", "tenant_id", trimmedTenantID, "conversation_id", trimmedConversationID, "err", err.Error())
		} else {
			for i, payload := range generationPayloads {
				genID, _ := payload["generation_id"].(string)
				if scores, ok := scoresByGen[genID]; ok {
					generationPayloads[i]["latest_scores"] = latestScoresToResponse(scores)
				}
			}
		}
	}

	annotations, err := s.listAllConversationAnnotations(ctx, trimmedTenantID, trimmedConversationID)
	if err != nil {
		return ConversationDetail{}, false, err
	}

	var ratingSummary *feedback.ConversationRatingSummary
	if s.ratingSummaryStore != nil {
		summary, err := s.ratingSummaryStore.GetConversationRatingSummary(ctx, trimmedTenantID, trimmedConversationID)
		if err != nil {
			return ConversationDetail{}, false, err
		}
		if summary != nil {
			copied := *summary
			ratingSummary = &copied
		}
	}

	return ConversationDetail{
		ConversationID:    conversation.ConversationID,
		GenerationCount:   conversation.GenerationCount,
		FirstGenerationAt: conversation.CreatedAt.UTC(),
		LastGenerationAt:  conversation.LastGenerationAt.UTC(),
		Generations:       generationPayloads,
		RatingSummary:     ratingSummary,
		Annotations:       annotations,
	}, true, nil
}

func (s *Service) GetGenerationDetailForTenant(ctx context.Context, tenantID, generationID string) (map[string]any, bool, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedGenerationID := strings.TrimSpace(generationID)
	if trimmedTenantID == "" {
		return nil, false, NewValidationError("tenant id is required")
	}
	if trimmedGenerationID == "" {
		return nil, false, NewValidationError("generation id is required")
	}
	if s.walReader == nil {
		return nil, false, errors.New("wal reader is not configured")
	}
	fanOutStore := s.fanOutStore
	if fanOutStore == nil {
		fanOutStore = storage.NewFanOutStore(s.walReader, nil, nil)
	}

	generation, err := fanOutStore.GetGenerationByID(ctx, trimmedTenantID, trimmedGenerationID)
	if err != nil {
		return nil, false, err
	}
	if generation == nil {
		return nil, false, nil
	}

	payload, err := generationToResponsePayload(generation)
	if err != nil {
		return nil, false, err
	}
	if s.scoreStore != nil {
		latestScores, err := s.scoreStore.GetLatestScoresByGeneration(ctx, trimmedTenantID, trimmedGenerationID)
		if err != nil {
			s.debugLog("latest_scores_enrichment_failed", "tenant_id", trimmedTenantID, "generation_id", trimmedGenerationID, "err", err.Error())
		} else {
			payload["latest_scores"] = latestScoresToResponse(latestScores)
		}
	}
	return payload, true, nil
}

func (s *Service) ListGenerationScoresForTenant(ctx context.Context, tenantID, generationID string, limit int, cursor uint64) ([]map[string]any, uint64, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedGenerationID := strings.TrimSpace(generationID)
	if trimmedTenantID == "" {
		return nil, 0, NewValidationError("tenant id is required")
	}
	if trimmedGenerationID == "" {
		return nil, 0, NewValidationError("generation id is required")
	}
	if s.scoreStore == nil {
		return nil, 0, errors.New("score store is not configured")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	scores, nextCursor, err := s.scoreStore.GetScoresByGeneration(ctx, trimmedTenantID, trimmedGenerationID, limit, cursor)
	if err != nil {
		return nil, 0, err
	}
	items := make([]map[string]any, 0, len(scores))
	for _, score := range scores {
		items = append(items, scoreToResponsePayload(score))
	}
	return items, nextCursor, nil
}

func (s *Service) ListSearchTagsForTenant(ctx context.Context, tenantID string, from, to time.Time) ([]SearchTag, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return nil, NewValidationError("tenant id is required")
	}
	if s.tempoClient == nil {
		return nil, errors.New("tempo client is not configured")
	}

	startTime, endTime := normalizeTagDiscoveryRange(from, to, s.now())

	spanTags, err := s.tempoClient.SearchTags(ctx, trimmedTenantID, "span", startTime, endTime)
	if err != nil {
		return nil, err
	}
	resourceTags, err := s.tempoClient.SearchTags(ctx, trimmedTenantID, "resource", startTime, endTime)
	if err != nil {
		return nil, err
	}

	tagMap := make(map[string]SearchTag)
	for _, tag := range WellKnownSearchTags() {
		tagMap[tag.Key] = tag
	}
	for _, tag := range spanTags {
		normalized := normalizeTempoTagKey("span", tag)
		tagMap[normalized] = SearchTag{Key: normalized, Scope: "span"}
	}
	for _, tag := range resourceTags {
		normalized := normalizeTempoTagKey("resource", tag)
		tagMap[normalized] = SearchTag{Key: normalized, Scope: "resource"}
	}

	out := make([]SearchTag, 0, len(tagMap))
	for _, tag := range tagMap {
		out = append(out, tag)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Key < out[j].Key
	})
	return out, nil
}

func (s *Service) ListSearchTagValuesForTenant(ctx context.Context, tenantID, tag string, from, to time.Time) ([]string, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return nil, NewValidationError("tenant id is required")
	}
	if s.tempoClient == nil {
		return nil, errors.New("tempo client is not configured")
	}

	tempoTag, mysqlOnly, err := resolveTagKeyForTempo(tag)
	if err != nil {
		return nil, NewValidationError(err.Error())
	}
	if !mysqlOnly && strings.TrimSpace(tempoTag) == "" {
		validationErr := NewValidationError(fmt.Sprintf("invalid tag %q", strings.TrimSpace(tag)))
		s.debugLog("search_tag_values_error",
			"requested_tag", strings.TrimSpace(tag),
			"resolved_tempo_tag", tempoTag,
			"error", validationErr.Error(),
		)
		return nil, validationErr
	}
	s.debugLog("search_tag_values_start",
		"tenant_id", trimmedTenantID,
		"requested_tag", strings.TrimSpace(tag),
		"resolved_tempo_tag", tempoTag,
		"mysql_only", mysqlOnly,
	)
	if mysqlOnly {
		s.debugLog("search_tag_values_done", "requested_tag", strings.TrimSpace(tag), "values_count", 0)
		return []string{}, nil
	}

	startTime, endTime := normalizeTagDiscoveryRange(from, to, s.now())
	values, err := s.tempoClient.SearchTagValues(ctx, trimmedTenantID, tempoTag, startTime, endTime)
	if err != nil {
		s.debugLog("search_tag_values_error",
			"requested_tag", strings.TrimSpace(tag),
			"resolved_tempo_tag", tempoTag,
			"error", err.Error(),
		)
		return nil, err
	}
	s.debugLog("search_tag_values_done",
		"requested_tag", strings.TrimSpace(tag),
		"resolved_tempo_tag", tempoTag,
		"values_count", len(values),
	)
	return values, nil
}

func (s *Service) loadConversationSearchMetadata(
	ctx context.Context,
	tenantID string,
	conversationIDs []string,
) (map[string]storage.Conversation, map[string]feedback.ConversationRatingSummary, map[string]feedback.ConversationAnnotationSummary, map[string]evalpkg.ConversationEvalSummary, error) {
	uniqueConversationIDs := dedupeAndSortStrings(conversationIDs)
	metadata := make(map[string]storage.Conversation, len(uniqueConversationIDs))
	for _, conversationID := range uniqueConversationIDs {
		conversation, err := s.conversationStore.GetConversation(ctx, tenantID, conversationID)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		if conversation == nil {
			continue
		}
		metadata[conversationID] = *conversation
	}

	ratingSummaries := make(map[string]feedback.ConversationRatingSummary)
	if s.ratingSummaryStore != nil && len(metadata) > 0 {
		lookupIDs := make([]string, 0, len(metadata))
		for conversationID := range metadata {
			lookupIDs = append(lookupIDs, conversationID)
		}
		summaries, err := s.ratingSummaryStore.ListConversationRatingSummaries(ctx, tenantID, lookupIDs)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		ratingSummaries = summaries
	}

	annotationSummaries := make(map[string]feedback.ConversationAnnotationSummary)
	if s.annotationSummaryStore != nil && len(metadata) > 0 {
		lookupIDs := make([]string, 0, len(metadata))
		for conversationID := range metadata {
			lookupIDs = append(lookupIDs, conversationID)
		}
		summaries, err := s.annotationSummaryStore.ListConversationAnnotationSummaries(ctx, tenantID, lookupIDs)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		annotationSummaries = summaries
	}

	evalSummaries := make(map[string]evalpkg.ConversationEvalSummary)
	if s.evalSummaryStore != nil && len(metadata) > 0 {
		lookupIDs := make([]string, 0, len(metadata))
		for conversationID := range metadata {
			lookupIDs = append(lookupIDs, conversationID)
		}
		summaries, err := s.evalSummaryStore.ListConversationEvalSummaries(ctx, tenantID, lookupIDs)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		evalSummaries = summaries
	}

	return metadata, ratingSummaries, annotationSummaries, evalSummaries, nil
}

func (s *Service) listAllConversationAnnotations(ctx context.Context, tenantID, conversationID string) ([]feedback.ConversationAnnotation, error) {
	if s.annotationEventStore == nil {
		return []feedback.ConversationAnnotation{}, nil
	}

	cursor := uint64(0)
	out := make([]feedback.ConversationAnnotation, 0)
	for {
		batch, nextCursor, err := s.annotationEventStore.ListConversationAnnotations(ctx, tenantID, conversationID, feedback.MaxPageLimit, cursor)
		if err != nil {
			return nil, err
		}
		out = append(out, batch...)
		if nextCursor == 0 || len(batch) == 0 {
			break
		}
		cursor = nextCursor
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].AnnotationID < out[j].AnnotationID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out, nil
}

func normalizeConversationSearchTimeRange(timeRange ConversationSearchTimeRange) (time.Time, time.Time, error) {
	from := timeRange.From.UTC()
	to := timeRange.To.UTC()
	if from.IsZero() || to.IsZero() {
		return time.Time{}, time.Time{}, NewValidationError("time_range.from and time_range.to are required")
	}
	if !from.Before(to) {
		return time.Time{}, time.Time{}, NewValidationError("time_range.from must be before time_range.to")
	}
	return from, to, nil
}

func validateMySQLFilterTerms(terms []FilterTerm) error {
	for _, term := range terms {
		if term.ResolvedKey != "generation_count" {
			continue
		}
		switch term.Operator {
		case FilterOperatorEqual,
			FilterOperatorNotEqual,
			FilterOperatorGreaterThan,
			FilterOperatorLessThan,
			FilterOperatorGreaterThanOrEqual,
			FilterOperatorLessThanOrEqual:
		default:
			return NewValidationError("generation_count supports only numeric comparison operators")
		}
		if _, err := strconv.Atoi(strings.TrimSpace(term.Value)); err != nil {
			return NewValidationError("generation_count value must be an integer")
		}
	}
	return nil
}

func matchesMySQLFilters(conversation storage.Conversation, terms []FilterTerm) bool {
	for _, term := range terms {
		if term.ResolvedKey != "generation_count" {
			continue
		}
		value, err := strconv.Atoi(strings.TrimSpace(term.Value))
		if err != nil {
			return false
		}

		count := conversation.GenerationCount
		switch term.Operator {
		case FilterOperatorEqual:
			if count != value {
				return false
			}
		case FilterOperatorNotEqual:
			if count == value {
				return false
			}
		case FilterOperatorGreaterThan:
			if count <= value {
				return false
			}
		case FilterOperatorGreaterThanOrEqual:
			if count < value {
				return false
			}
		case FilterOperatorLessThan:
			if count >= value {
				return false
			}
		case FilterOperatorLessThanOrEqual:
			if count > value {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func orderTempoConversationIDs(conversations map[string]*tempoConversationAggregate) []string {
	ids := make([]string, 0, len(conversations))
	for conversationID := range conversations {
		ids = append(ids, conversationID)
	}
	sort.Slice(ids, func(i, j int) bool {
		left := conversations[ids[i]]
		right := conversations[ids[j]]
		if left.LatestTraceStartNanos == right.LatestTraceStartNanos {
			return ids[i] < ids[j]
		}
		return left.LatestTraceStartNanos > right.LatestTraceStartNanos
	})
	return ids
}

func buildSelectedResultMap(selected map[string]*tempoSelectedAggregation) map[string]any {
	if len(selected) == 0 {
		return nil
	}
	out := make(map[string]any, len(selected))
	for key, aggregation := range selected {
		if aggregation == nil {
			continue
		}
		if aggregation.HasNumeric {
			out[key] = aggregation.NumericSum
			continue
		}
		if len(aggregation.DistinctValues) == 0 {
			continue
		}
		out[key] = sortedKeysFromSet(aggregation.DistinctValues)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func generationToResponsePayload(generation *sigilv1.Generation) (map[string]any, error) {
	payloadBytes, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(generation)
	if err != nil {
		return nil, fmt.Errorf("marshal generation payload: %w", err)
	}

	payload := make(map[string]any)
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, fmt.Errorf("decode generation payload: %w", err)
	}

	if id, ok := payload["id"]; ok {
		payload["generation_id"] = id
		delete(payload, "id")
	}
	if mode, ok := payload["mode"].(string); ok {
		payload["mode"] = normalizeGenerationMode(mode)
	}

	createdAt := generationTimestamp(generation)
	if !createdAt.IsZero() {
		payload["created_at"] = createdAt.UTC().Format(time.RFC3339Nano)
	}
	if strings.TrimSpace(generation.GetCallError()) == "" {
		payload["error"] = nil
	} else {
		payload["error"] = map[string]any{"message": generation.GetCallError()}
	}
	return payload, nil
}

func scoreToResponsePayload(score evalpkg.GenerationScore) map[string]any {
	payload := map[string]any{
		"score_id":          score.ScoreID,
		"generation_id":     score.GenerationID,
		"evaluator_id":      score.EvaluatorID,
		"evaluator_version": score.EvaluatorVersion,
		"score_key":         score.ScoreKey,
		"score_type":        score.ScoreType,
		"value":             scoreValueToResponse(score.Value),
		"metadata":          score.Metadata,
		"created_at":        score.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if score.RuleID != "" {
		payload["rule_id"] = score.RuleID
	}
	if score.RunID != "" {
		payload["run_id"] = score.RunID
	}
	if score.ConversationID != "" {
		payload["conversation_id"] = score.ConversationID
	}
	if score.TraceID != "" {
		payload["trace_id"] = score.TraceID
	}
	if score.SpanID != "" {
		payload["span_id"] = score.SpanID
	}
	if score.Unit != "" {
		payload["unit"] = score.Unit
	}
	if score.Passed != nil {
		payload["passed"] = *score.Passed
	}
	if score.Explanation != "" {
		payload["explanation"] = score.Explanation
	}
	if score.SourceKind != "" || score.SourceID != "" {
		payload["source"] = map[string]any{
			"kind": score.SourceKind,
			"id":   score.SourceID,
		}
	}
	return payload
}

func latestScoresToResponse(scores map[string]evalpkg.LatestScore) map[string]any {
	if len(scores) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(scores))
	for key, score := range scores {
		entry := map[string]any{
			"value":             scoreValueToResponse(score.Value),
			"evaluator_id":      score.EvaluatorID,
			"evaluator_version": score.EvaluatorVersion,
			"created_at":        score.CreatedAt.UTC().Format(time.RFC3339Nano),
		}
		if score.Passed != nil {
			entry["passed"] = *score.Passed
		}
		out[key] = entry
	}
	return out
}

func scoreValueToResponse(value evalpkg.ScoreValue) map[string]any {
	switch {
	case value.Number != nil:
		return map[string]any{"number": *value.Number}
	case value.Bool != nil:
		return map[string]any{"bool": *value.Bool}
	case value.String != nil:
		return map[string]any{"string": *value.String}
	default:
		return map[string]any{}
	}
}

func normalizeGenerationMode(mode string) string {
	trimmed := strings.TrimSpace(mode)
	trimmed = strings.TrimPrefix(trimmed, "GENERATION_MODE_")
	return trimmed
}

func generationTimestamp(generation *sigilv1.Generation) time.Time {
	if generation == nil {
		return time.Time{}
	}
	if completedAt := generation.GetCompletedAt(); completedAt != nil {
		return completedAt.AsTime().UTC()
	}
	if startedAt := generation.GetStartedAt(); startedAt != nil {
		return startedAt.AsTime().UTC()
	}
	return time.Time{}
}

func normalizeTempoTagKey(scope string, key string) string {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "span.") || strings.HasPrefix(trimmed, "resource.") {
		return trimmed
	}
	return strings.TrimSpace(scope) + "." + trimmed
}

func (s *Service) ListConversations() []Conversation {
	items, err := s.ListConversationsForTenant(context.Background(), "", ConversationListFilter{})
	if err != nil {
		return s.bootstrapConversations()
	}
	return items
}

func (s *Service) GetConversation(id string) Conversation {
	item, found, err := s.GetConversationForTenant(context.Background(), "", id)
	if err != nil || !found {
		return s.bootstrapConversation(id)
	}
	return item
}

func (s *Service) bootstrapConversations() []Conversation {
	return []Conversation{s.bootstrapConversation("c-bootstrap")}
}

func (s *Service) bootstrapConversation(id string) Conversation {
	now := s.now().UTC()
	return Conversation{
		ID:               id,
		Title:            "Sigil bootstrap conversation",
		LastGenerationAt: now,
		GenerationCount:  0,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
}

func (s *Service) now() time.Time {
	if s != nil && s.nowFn != nil {
		return s.nowFn()
	}
	return time.Now()
}

func toConversation(row storage.Conversation) Conversation {
	return Conversation{
		ID:               row.ConversationID,
		Title:            row.ConversationID,
		LastGenerationAt: row.LastGenerationAt.UTC(),
		GenerationCount:  row.GenerationCount,
		CreatedAt:        row.CreatedAt.UTC(),
		UpdatedAt:        row.UpdatedAt.UTC(),
	}
}

func matchesConversationFilter(item Conversation, filter ConversationListFilter) bool {
	if filter.HasBadRating != nil {
		hasBad := item.RatingSummary != nil && item.RatingSummary.HasBadRating
		if hasBad != *filter.HasBadRating {
			return false
		}
	}
	if filter.HasAnnotations != nil {
		hasAnnotations := item.AnnotationSummary != nil && item.AnnotationSummary.AnnotationCount > 0
		if hasAnnotations != *filter.HasAnnotations {
			return false
		}
	}
	return true
}
