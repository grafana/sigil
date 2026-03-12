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
	"sync"
	"time"

	"github.com/grafana/sigil/sigil/internal/agentmeta"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/feedback"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/pkg/searchcore"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	generationMetadataUserIDKey       = "sigil.user.id"
	generationMetadataLegacyUserIDKey = "user.id"
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
	ConversationTitle string                              `json:"conversation_title,omitempty"`
	UserID            string                              `json:"user_id,omitempty"`
	GenerationCount   int                                 `json:"generation_count"`
	FirstGenerationAt time.Time                           `json:"first_generation_at"`
	LastGenerationAt  time.Time                           `json:"last_generation_at"`
	Models            []string                            `json:"models"`
	ModelProviders    map[string]string                   `json:"model_providers,omitempty"`
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

type searchCandidate struct {
	conversationID string
	aggregate      *tempoConversationAggregate
	metadata       storage.Conversation
	traceTitle     string
}

// ConversationBatchMetadata contains conversation metadata enriched with
// optional feedback and eval summaries for batch lookup callers.
type ConversationBatchMetadata struct {
	ConversationID    string                              `json:"conversation_id"`
	ConversationTitle string                              `json:"conversation_title,omitempty"`
	UserID            string                              `json:"user_id,omitempty"`
	GenerationCount   int                                 `json:"generation_count"`
	FirstGenerationAt time.Time                           `json:"first_generation_at"`
	LastGenerationAt  time.Time                           `json:"last_generation_at"`
	Models            []string                            `json:"models"`
	ModelProviders    map[string]string                   `json:"model_providers,omitempty"`
	Agents            []string                            `json:"agents"`
	ErrorCount        int                                 `json:"error_count"`
	HasErrors         bool                                `json:"has_errors"`
	InputTokens       int64                               `json:"input_tokens"`
	OutputTokens      int64                               `json:"output_tokens"`
	CacheReadTokens   int64                               `json:"cache_read_tokens"`
	CacheWriteTokens  int64                               `json:"cache_write_tokens"`
	ReasoningTokens   int64                               `json:"reasoning_tokens"`
	TotalTokens       int64                               `json:"total_tokens"`
	RatingSummary     *feedback.ConversationRatingSummary `json:"rating_summary,omitempty"`
	AnnotationCount   int                                 `json:"annotation_count"`
	EvalSummary       *evalpkg.ConversationEvalSummary    `json:"eval_summary,omitempty"`
}

type ConversationDetail struct {
	ConversationID    string                              `json:"conversation_id"`
	ConversationTitle string                              `json:"conversation_title,omitempty"`
	UserID            string                              `json:"user_id,omitempty"`
	GenerationCount   int                                 `json:"generation_count"`
	FirstGenerationAt time.Time                           `json:"first_generation_at"`
	LastGenerationAt  time.Time                           `json:"last_generation_at"`
	Generations       []map[string]any                    `json:"generations"`
	RatingSummary     *feedback.ConversationRatingSummary `json:"rating_summary,omitempty"`
	Annotations       []feedback.ConversationAnnotation   `json:"annotations"`
}

type generationTitleSnapshot struct {
	Title     string
	Timestamp time.Time
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

type agentCatalogStore interface {
	ListAgentHeads(ctx context.Context, tenantID string, limit int, cursor *storage.AgentHeadCursor, filter storage.AgentHeadFilter) ([]storage.AgentHead, *storage.AgentHeadCursor, error)
	GetAgentVersion(ctx context.Context, tenantID, agentName, effectiveVersion string) (*storage.AgentVersion, error)
	GetLatestAgentVersion(ctx context.Context, tenantID, agentName string) (*storage.AgentVersion, error)
	ListAgentVersions(ctx context.Context, tenantID, agentName string, limit int, cursor *storage.AgentVersionCursor) ([]storage.AgentVersionSummary, *storage.AgentVersionCursor, error)
	ListAgentVersionModels(ctx context.Context, tenantID, agentName, effectiveVersion string) ([]storage.AgentVersionModel, error)
}

type batchConversationStore interface {
	GetConversations(ctx context.Context, tenantID string, conversationIDs []string) ([]storage.Conversation, error)
}

type filteredConversationStore interface {
	ListConversationsWithFeedbackFilters(ctx context.Context, tenantID string, hasBadRating, hasAnnotations *bool) ([]storage.Conversation, error)
}

type projectionConversationPageStore interface {
	ListConversationProjectionPage(ctx context.Context, tenantID string, filter storage.ConversationProjectionPageQuery) ([]storage.ConversationProjectionPageItem, bool, error)
}

type ServiceDependencies struct {
	ConversationStore   storage.ConversationStore
	WALReader           storage.WALReader
	BlockMetadataStore  storage.BlockMetadataStore
	BlockReader         storage.BlockReader
	FanOutStore         storage.GenerationFanOutReader
	AgentCatalogStore   storage.AgentCatalogStore
	FeedbackStore       feedback.Store
	ScoreStore          scoreStore
	EvalSummaryStore    evalSummaryStore
	TempoBaseURL        string
	HTTPClient          *http.Client
	OverfetchMultiplier int
	MaxSearchIterations int
	ColdReadConfig      storage.ColdReadConfig
	IndexCacheConfig    storage.IndexCacheConfig
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
	agentCatalogStore      agentCatalogStore
	tempoClient            TempoClient
	nowFn                  func() time.Time
	overfetchMultiplier    int
	maxSearchIterations    int
	queryDebug             bool
}

var queryServiceTracer = otel.Tracer("github.com/grafana/sigil/query/service")

type plannedConversationFanOutReader interface {
	ListConversationGenerationsWithPlan(ctx context.Context, tenantID, conversationID string, plan storage.ConversationReadPlan) ([]*sigilv1.Generation, error)
}

type plannedGenerationFanOutReader interface {
	GetGenerationByIDWithPlan(ctx context.Context, tenantID, generationID string, plan storage.GenerationReadPlan) (*sigilv1.Generation, error)
}

type GenerationDetailReadPlan struct {
	ConversationID string
	From           time.Time
	To             time.Time
	At             time.Time
}

func recordQuerySpanError(span trace.Span, err error) {
	if span == nil || err == nil {
		return
	}
	span.RecordError(err)
	span.SetStatus(codes.Error, err.Error())
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
	if store, ok := conversationStore.(agentCatalogStore); ok {
		service.agentCatalogStore = store
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
		if store, ok := dependencies.WALReader.(agentCatalogStore); ok {
			service.agentCatalogStore = store
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
	if dependencies.AgentCatalogStore != nil {
		service.agentCatalogStore = dependencies.AgentCatalogStore
	}
	if dependencies.FanOutStore != nil {
		service.fanOutStore = dependencies.FanOutStore
	} else {
		options := []storage.FanOutOption{}
		if dependencies.ColdReadConfig.TotalBudget > 0 ||
			dependencies.ColdReadConfig.IndexReadTimeout > 0 ||
			dependencies.ColdReadConfig.IndexRetries > 0 ||
			dependencies.ColdReadConfig.IndexWorkers > 0 ||
			dependencies.ColdReadConfig.IndexMaxInflight > 0 {
			options = append(options, storage.WithColdReadConfig(dependencies.ColdReadConfig))
		}
		if dependencies.IndexCacheConfig.Enabled {
			options = append(options, storage.WithIndexCacheConfig(dependencies.IndexCacheConfig))
		}
		service.fanOutStore = storage.NewFanOutStore(service.walReader, blockMetadataStore, dependencies.BlockReader, options...)
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

func (s *Service) errorLog(event string, keyvals ...any) {
	payload := make([]any, 0, len(keyvals)+2)
	payload = append(payload, "event", event)
	payload = append(payload, keyvals...)
	slog.Error("sigil query error", payload...)
}

func (s *Service) ListConversationsForTenant(ctx context.Context, tenantID string, filter ConversationListFilter) ([]Conversation, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.list_conversations")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	span.SetAttributes(attribute.String("sigil.tenant.id", trimmedTenantID))
	if s.conversationStore == nil || trimmedTenantID == "" {
		items := s.bootstrapConversations()
		span.SetAttributes(
			attribute.String("sigil.query.source", "bootstrap"),
			attribute.Int("sigil.query.conversation_count", len(items)),
		)
		return items, nil
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
		recordQuerySpanError(span, err)
		return nil, err
	}
	if len(rows) == 0 {
		span.SetAttributes(attribute.Int("sigil.query.conversation_count", 0))
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
			recordQuerySpanError(span, err)
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
			recordQuerySpanError(span, err)
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
		span.SetAttributes(attribute.Int("sigil.query.conversation_count", len(filtered)))
		return filtered, nil
	}

	span.SetAttributes(attribute.Int("sigil.query.conversation_count", len(items)))
	return items, nil
}

func (s *Service) GetConversationForTenant(ctx context.Context, tenantID, id string) (Conversation, bool, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.get_conversation")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedConversationID := strings.TrimSpace(id)
	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.String("sigil.conversation.id", trimmedConversationID),
	)
	if trimmedConversationID == "" {
		return Conversation{}, false, nil
	}
	if s.conversationStore == nil || trimmedTenantID == "" {
		item := s.bootstrapConversation(trimmedConversationID)
		span.SetAttributes(
			attribute.Bool("sigil.query.found", true),
			attribute.String("sigil.query.source", "bootstrap"),
		)
		return item, true, nil
	}

	row, err := s.conversationStore.GetConversation(ctx, trimmedTenantID, trimmedConversationID)
	if err != nil {
		recordQuerySpanError(span, err)
		return Conversation{}, false, err
	}
	if row == nil {
		span.SetAttributes(attribute.Bool("sigil.query.found", false))
		return Conversation{}, false, nil
	}

	out := toConversation(*row)
	if s.ratingSummaryStore != nil {
		summary, err := s.ratingSummaryStore.GetConversationRatingSummary(ctx, trimmedTenantID, trimmedConversationID)
		if err != nil {
			recordQuerySpanError(span, err)
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
			recordQuerySpanError(span, err)
			return Conversation{}, false, err
		}
		if summary != nil {
			copied := *summary
			out.AnnotationSummary = &copied
		}
	}
	span.SetAttributes(attribute.Bool("sigil.query.found", true))
	return out, true, nil
}

func (s *Service) SearchConversationsForTenant(ctx context.Context, tenantID string, request ConversationSearchRequest) (ConversationSearchResponse, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.search_conversations")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.Int("sigil.query.requested_page_size", request.PageSize),
		attribute.Int("sigil.query.select_count", len(request.Select)),
		attribute.Bool("sigil.query.cursor_provided", strings.TrimSpace(request.Cursor) != ""),
	)
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return ConversationSearchResponse{}, err
	}
	if s.tempoClient == nil {
		err := errors.New("tempo client is not configured")
		recordQuerySpanError(span, err)
		return ConversationSearchResponse{}, err
	}
	if s.conversationStore == nil {
		err := errors.New("conversation store is not configured")
		recordQuerySpanError(span, err)
		return ConversationSearchResponse{}, err
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
		recordQuerySpanError(span, err)
		return ConversationSearchResponse{}, err
	}

	parsedFilters, err := ParseFilterExpression(request.Filters)
	if err != nil {
		validationErr := NewValidationError(err.Error())
		recordQuerySpanError(span, validationErr)
		return ConversationSearchResponse{}, validationErr
	}
	if err := validateMySQLFilterTerms(parsedFilters.MySQLTerms); err != nil {
		recordQuerySpanError(span, err)
		return ConversationSearchResponse{}, err
	}

	selectFields, err := NormalizeSelectFields(request.Select)
	if err != nil {
		validationErr := NewValidationError(err.Error())
		recordQuerySpanError(span, validationErr)
		return ConversationSearchResponse{}, validationErr
	}

	pageSize := normalizeConversationSearchPageSize(request.PageSize)
	overfetchLimit := pageSize * s.overfetchMultiplier
	if overfetchLimit < pageSize {
		overfetchLimit = pageSize
	}

	filterHash := buildConversationSearchFilterHash(parsedFilters, selectFields, from, to)
	cursor, err := decodeConversationSearchCursor(request.Cursor)
	if err != nil {
		validationErr := NewValidationError("invalid cursor")
		recordQuerySpanError(span, validationErr)
		return ConversationSearchResponse{}, validationErr
	}
	if strings.TrimSpace(request.Cursor) != "" && cursor.FilterHash != filterHash {
		validationErr := NewValidationError("cursor no longer matches current filters")
		recordQuerySpanError(span, validationErr)
		return ConversationSearchResponse{}, validationErr
	}

	traceQL, err := BuildTraceQL(parsedFilters, selectFields)
	if err != nil {
		validationErr := NewValidationError(err.Error())
		recordQuerySpanError(span, validationErr)
		return ConversationSearchResponse{}, validationErr
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
		span.SetAttributes(
			attribute.Int("sigil.query.result_count", 0),
			attribute.Bool("sigil.query.has_more", false),
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
			s.errorLog(
				"conversation_search_tempo_failed",
				"tenant_id", trimmedTenantID,
				"filters", strings.TrimSpace(request.Filters),
				"iteration", iteration,
				"window_start_unix", from.Unix(),
				"window_end_unix", windowEnd.Unix(),
				"page_size", pageSize,
				"err", err.Error(),
			)
			recordQuerySpanError(span, err)
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
			s.errorLog(
				"conversation_search_metadata_failed",
				"tenant_id", trimmedTenantID,
				"filters", strings.TrimSpace(request.Filters),
				"iteration", iteration,
				"conversation_candidates", len(orderedConversationIDs),
				"page_size", pageSize,
				"err", err.Error(),
			)
			recordQuerySpanError(span, err)
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

		var candidates []searchCandidate
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

			if len(results)+len(candidates) >= pageSize {
				foundAdditionalConversation = true
				break
			}

			aggregate := grouped.Conversations[conversationID]
			candidates = append(candidates, searchCandidate{
				conversationID: conversationID,
				aggregate:      aggregate,
				metadata:       conversationMetadata,
				traceTitle:     strings.TrimSpace(aggregate.ConversationTitle),
			})
		}

		for _, candidate := range candidates {
			conversationTitle := strings.TrimSpace(candidate.metadata.ConversationTitle)
			if conversationTitle == "" {
				// Projection titles are ingest-time only. We do not backfill historical
				// conversation_title values from stored generations, so older rows may
				// legitimately fall back to the Tempo span title or stay blank.
				conversationTitle = candidate.traceTitle
			}
			userID := strings.TrimSpace(candidate.metadata.UserID)
			if userID == "" {
				userID = candidate.aggregate.UserID
			}
			// Search returns current/lifetime conversation summaries, not match-window
			// summaries. Projection metadata is authoritative here by design. We do not
			// backfill historical rows, so upgraded deployments may show partial
			// lifetime summaries for older conversations until they receive new ingest.
			models := append([]string{}, candidate.metadata.Models...)
			if len(models) == 0 {
				models = sortedKeysFromSet(candidate.aggregate.Models)
			}
			modelProviders := cloneStringMap(candidate.metadata.ModelProviders)
			if len(modelProviders) == 0 {
				modelProviders = cloneStringMap(candidate.aggregate.ModelProviders)
			}
			agents := append([]string{}, candidate.metadata.Agents...)
			if len(agents) == 0 {
				agents = sortedKeysFromSet(candidate.aggregate.Agents)
			}
			errorCount := candidate.metadata.ErrorCount
			if candidate.aggregate.ErrorCount > errorCount {
				errorCount = candidate.aggregate.ErrorCount
			}
			result := ConversationSearchResult{
				ConversationID:    candidate.conversationID,
				ConversationTitle: conversationTitle,
				UserID:            userID,
				GenerationCount:   candidate.metadata.GenerationCount,
				FirstGenerationAt: candidate.metadata.FirstGenerationAt.UTC(),
				LastGenerationAt:  candidate.metadata.LastGenerationAt.UTC(),
				Models:            models,
				ModelProviders:    modelProviders,
				Agents:            agents,
				ErrorCount:        errorCount,
				HasErrors:         errorCount > 0,
				TraceIDs:          sortedKeysFromSet(candidate.aggregate.TraceIDs),
				AnnotationCount:   annotationSummaries[candidate.conversationID].AnnotationCount,
			}
			if ratingSummary, ok := ratingSummaries[candidate.conversationID]; ok {
				copied := ratingSummary
				result.RatingSummary = &copied
			}
			if evalSummary, ok := evalSummaries[candidate.conversationID]; ok {
				copied := evalSummary
				result.EvalSummary = &copied
			}
			// Token select fields follow the same lifetime-summary contract as the rest
			// of the conversation row on this path. We intentionally prefer projection
			// counters and do not preserve historical Tempo-only values for unbackfilled
			// conversations.
			result.Selected = buildSelectedResultMapWithConversationMetadata(candidate.aggregate.Selected, candidate.metadata, selectFields)

			results = append(results, result)
			currentPageIDs[candidate.conversationID] = struct{}{}
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
			recordQuerySpanError(span, err)
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
	span.SetAttributes(
		attribute.Int("sigil.query.result_count", len(results)),
		attribute.Bool("sigil.query.has_more", hasMore),
		attribute.Bool("sigil.query.next_cursor_present", nextCursor != ""),
	)
	return ConversationSearchResponse{
		Conversations: results,
		NextCursor:    nextCursor,
		HasMore:       hasMore,
	}, nil
}

func (s *Service) GetConversationDetailForTenant(ctx context.Context, tenantID, conversationID string) (ConversationDetail, bool, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.get_conversation_detail")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedConversationID := strings.TrimSpace(conversationID)
	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.String("sigil.conversation.id", trimmedConversationID),
	)
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return ConversationDetail{}, false, err
	}
	if trimmedConversationID == "" {
		err := NewValidationError("conversation id is required")
		recordQuerySpanError(span, err)
		return ConversationDetail{}, false, err
	}
	if s.conversationStore == nil {
		err := errors.New("conversation store is not configured")
		recordQuerySpanError(span, err)
		return ConversationDetail{}, false, err
	}
	if s.walReader == nil {
		err := errors.New("wal reader is not configured")
		recordQuerySpanError(span, err)
		return ConversationDetail{}, false, err
	}
	fanOutStore := s.fanOutStore
	if fanOutStore == nil {
		fanOutStore = storage.NewFanOutStore(s.walReader, nil, nil)
	}

	conversation, err := s.conversationStore.GetConversation(ctx, trimmedTenantID, trimmedConversationID)
	if err != nil {
		recordQuerySpanError(span, err)
		return ConversationDetail{}, false, err
	}
	if conversation == nil {
		span.SetAttributes(attribute.Bool("sigil.query.found", false))
		return ConversationDetail{}, false, nil
	}

	plan := storage.ConversationReadPlan{
		ExpectedGenerationCount: conversation.GenerationCount,
	}
	if !conversation.LastGenerationAt.IsZero() {
		plan.To = conversation.LastGenerationAt.UTC().Add(2 * time.Minute)
	}
	var mergedGenerations []*sigilv1.Generation
	if plannedReader, ok := fanOutStore.(plannedConversationFanOutReader); ok {
		mergedGenerations, err = plannedReader.ListConversationGenerationsWithPlan(ctx, trimmedTenantID, trimmedConversationID, plan)
	} else {
		mergedGenerations, err = fanOutStore.ListConversationGenerations(ctx, trimmedTenantID, trimmedConversationID)
	}
	if err != nil {
		recordQuerySpanError(span, err)
		return ConversationDetail{}, false, err
	}
	userID := latestConversationUserID(mergedGenerations)

	generationPayloads := make([]map[string]any, 0, len(mergedGenerations))
	for _, generation := range mergedGenerations {
		payload, err := generationToResponsePayload(generation)
		if err != nil {
			recordQuerySpanError(span, err)
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
		recordQuerySpanError(span, err)
		return ConversationDetail{}, false, err
	}

	var ratingSummary *feedback.ConversationRatingSummary
	if s.ratingSummaryStore != nil {
		summary, err := s.ratingSummaryStore.GetConversationRatingSummary(ctx, trimmedTenantID, trimmedConversationID)
		if err != nil {
			recordQuerySpanError(span, err)
			return ConversationDetail{}, false, err
		}
		if summary != nil {
			copied := *summary
			ratingSummary = &copied
		}
	}
	span.SetAttributes(
		attribute.Bool("sigil.query.found", true),
		attribute.Int("sigil.query.generation_count", len(generationPayloads)),
		attribute.Int("sigil.query.annotation_count", len(annotations)),
	)
	return ConversationDetail{
		ConversationID:    conversation.ConversationID,
		ConversationTitle: conversation.ConversationTitle,
		UserID:            userID,
		GenerationCount:   conversation.GenerationCount,
		FirstGenerationAt: conversation.FirstGenerationAt.UTC(),
		LastGenerationAt:  conversation.LastGenerationAt.UTC(),
		Generations:       generationPayloads,
		RatingSummary:     ratingSummary,
		Annotations:       annotations,
	}, true, nil
}

func (s *Service) GetConversationDetailV2ForTenant(ctx context.Context, tenantID, conversationID string) (ConversationDetailV2, bool, error) {
	detail, found, err := s.GetConversationDetailForTenant(ctx, tenantID, conversationID)
	if err != nil || !found {
		return ConversationDetailV2{}, found, err
	}

	v2, err := BuildConversationDetailV2(detail)
	if err != nil {
		return ConversationDetailV2{}, false, err
	}
	return v2, true, nil
}

// ListConversationGenerationsForTenant returns raw protobuf generations for a
// conversation, using the same hot/cold fan-out as GetConversationDetailForTenant.
func (s *Service) ListConversationGenerationsForTenant(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, bool, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.list_conversation_generations")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedConversationID := strings.TrimSpace(conversationID)
	if trimmedTenantID == "" {
		return nil, false, NewValidationError("tenant id is required")
	}
	if trimmedConversationID == "" {
		return nil, false, NewValidationError("conversation id is required")
	}
	if s.conversationStore == nil {
		return nil, false, errors.New("conversation store is not configured")
	}
	if s.walReader == nil {
		return nil, false, errors.New("wal reader is not configured")
	}

	fanOutStore := s.fanOutStore
	if fanOutStore == nil {
		fanOutStore = storage.NewFanOutStore(s.walReader, nil, nil)
	}

	conversation, err := s.conversationStore.GetConversation(ctx, trimmedTenantID, trimmedConversationID)
	if err != nil {
		return nil, false, err
	}
	if conversation == nil {
		return nil, false, nil
	}

	plan := storage.ConversationReadPlan{
		ExpectedGenerationCount: conversation.GenerationCount,
	}
	if !conversation.LastGenerationAt.IsZero() {
		plan.To = conversation.LastGenerationAt.UTC().Add(2 * time.Minute)
	}

	var generations []*sigilv1.Generation
	if plannedReader, ok := fanOutStore.(plannedConversationFanOutReader); ok {
		generations, err = plannedReader.ListConversationGenerationsWithPlan(ctx, trimmedTenantID, trimmedConversationID, plan)
	} else {
		generations, err = fanOutStore.ListConversationGenerations(ctx, trimmedTenantID, trimmedConversationID)
	}
	if err != nil {
		return nil, false, err
	}

	span.SetAttributes(
		attribute.Bool("sigil.query.found", true),
		attribute.Int("sigil.query.generation_count", len(generations)),
	)
	return generations, true, nil
}

func (s *Service) GetGenerationDetailForTenant(ctx context.Context, tenantID, generationID string) (map[string]any, bool, error) {
	return s.GetGenerationDetailForTenantWithPlan(ctx, tenantID, generationID, GenerationDetailReadPlan{})
}

func (s *Service) GetGenerationDetailForTenantWithPlan(
	ctx context.Context,
	tenantID,
	generationID string,
	plan GenerationDetailReadPlan,
) (map[string]any, bool, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.get_generation_detail")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedGenerationID := strings.TrimSpace(generationID)
	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.String("sigil.generation.id", trimmedGenerationID),
		attribute.String("sigil.query.hint_conversation_id", strings.TrimSpace(plan.ConversationID)),
		attribute.Bool("sigil.query.hint_has_range", !plan.From.IsZero() && !plan.To.IsZero()),
		attribute.Bool("sigil.query.hint_has_at", !plan.At.IsZero()),
	)
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return nil, false, err
	}
	if trimmedGenerationID == "" {
		err := NewValidationError("generation id is required")
		recordQuerySpanError(span, err)
		return nil, false, err
	}
	if s.walReader == nil {
		err := errors.New("wal reader is not configured")
		recordQuerySpanError(span, err)
		return nil, false, err
	}
	fanOutStore := s.fanOutStore
	if fanOutStore == nil {
		fanOutStore = storage.NewFanOutStore(s.walReader, nil, nil)
	}

	storagePlan := storage.GenerationReadPlan{
		ConversationID: strings.TrimSpace(plan.ConversationID),
		From:           plan.From.UTC(),
		To:             plan.To.UTC(),
		At:             plan.At.UTC(),
	}
	var (
		generation *sigilv1.Generation
		err        error
	)
	if plannedReader, ok := fanOutStore.(plannedGenerationFanOutReader); ok {
		generation, err = plannedReader.GetGenerationByIDWithPlan(ctx, trimmedTenantID, trimmedGenerationID, storagePlan)
	} else {
		generation, err = fanOutStore.GetGenerationByID(ctx, trimmedTenantID, trimmedGenerationID)
	}
	if err != nil {
		recordQuerySpanError(span, err)
		return nil, false, err
	}
	if generation == nil {
		span.SetAttributes(attribute.Bool("sigil.query.found", false))
		return nil, false, nil
	}

	payload, err := generationToResponsePayload(generation)
	if err != nil {
		recordQuerySpanError(span, err)
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
	span.SetAttributes(
		attribute.Bool("sigil.query.found", true),
		attribute.Bool("sigil.query.latest_scores_present", payload["latest_scores"] != nil),
	)
	return payload, true, nil
}

func (s *Service) ListGenerationScoresForTenant(ctx context.Context, tenantID, generationID string, limit int, cursor uint64) ([]map[string]any, uint64, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.list_generation_scores")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedGenerationID := strings.TrimSpace(generationID)
	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.String("sigil.generation.id", trimmedGenerationID),
		attribute.Int("sigil.query.limit", limit),
		attribute.Int64("sigil.query.cursor", int64(cursor)),
	)
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return nil, 0, err
	}
	if trimmedGenerationID == "" {
		err := NewValidationError("generation id is required")
		recordQuerySpanError(span, err)
		return nil, 0, err
	}
	if s.scoreStore == nil {
		err := errors.New("score store is not configured")
		recordQuerySpanError(span, err)
		return nil, 0, err
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	scores, nextCursor, err := s.scoreStore.GetScoresByGeneration(ctx, trimmedTenantID, trimmedGenerationID, limit, cursor)
	if err != nil {
		recordQuerySpanError(span, err)
		return nil, 0, err
	}
	items := make([]map[string]any, 0, len(scores))
	for _, score := range scores {
		items = append(items, scoreToResponsePayload(score))
	}
	span.SetAttributes(
		attribute.Int("sigil.query.result_count", len(items)),
		attribute.Int64("sigil.query.next_cursor", int64(nextCursor)),
	)
	return items, nextCursor, nil
}

func (s *Service) ListSearchTagsForTenant(ctx context.Context, tenantID string, from, to time.Time) ([]SearchTag, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.list_search_tags")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	span.SetAttributes(attribute.String("sigil.tenant.id", trimmedTenantID))
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return nil, err
	}
	if s.tempoClient == nil {
		err := errors.New("tempo client is not configured")
		recordQuerySpanError(span, err)
		return nil, err
	}

	startTime, endTime := normalizeTagDiscoveryRange(from, to, s.now())

	spanTags, err := s.tempoClient.SearchTags(ctx, trimmedTenantID, "span", startTime, endTime)
	if err != nil {
		recordQuerySpanError(span, err)
		return nil, err
	}
	resourceTags, err := s.tempoClient.SearchTags(ctx, trimmedTenantID, "resource", startTime, endTime)
	if err != nil {
		recordQuerySpanError(span, err)
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
	span.SetAttributes(attribute.Int("sigil.query.result_count", len(out)))
	return out, nil
}

// ListConversationBatchMetadataForTenant returns metadata rows for the requested
// conversation IDs and a list of IDs that were not found.
func (s *Service) ListConversationBatchMetadataForTenant(
	ctx context.Context,
	tenantID string,
	conversationIDs []string,
) ([]ConversationBatchMetadata, []string, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.list_conversation_batch_metadata")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.Int("sigil.query.requested_conversation_count", len(conversationIDs)),
	)
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return nil, nil, err
	}
	if s.conversationStore == nil {
		err := errors.New("conversation store is not configured")
		recordQuerySpanError(span, err)
		return nil, nil, err
	}

	ids := dedupeAndSortStrings(conversationIDs)
	if len(ids) == 0 {
		span.SetAttributes(
			attribute.Int("sigil.query.result_count", 0),
			attribute.Int("sigil.query.missing_count", 0),
		)
		return []ConversationBatchMetadata{}, []string{}, nil
	}

	rowsByID := make(map[string]storage.Conversation, len(ids))
	missing := make([]string, 0)
	if batchStore, ok := s.conversationStore.(batchConversationStore); ok {
		rows, err := batchStore.GetConversations(ctx, trimmedTenantID, ids)
		if err != nil {
			s.errorLog(
				"conversation_batch_metadata_load_failed",
				"tenant_id", trimmedTenantID,
				"requested_conversation_count", len(ids),
				"storage_mode", "batch",
				"err", err.Error(),
			)
			recordQuerySpanError(span, err)
			return nil, nil, err
		}
		for _, row := range rows {
			rowsByID[row.ConversationID] = row
		}
		for _, conversationID := range ids {
			if _, ok := rowsByID[conversationID]; !ok {
				missing = append(missing, conversationID)
			}
		}
	} else {
		for _, conversationID := range ids {
			row, err := s.conversationStore.GetConversation(ctx, trimmedTenantID, conversationID)
			if err != nil {
				s.errorLog(
					"conversation_batch_metadata_load_failed",
					"tenant_id", trimmedTenantID,
					"requested_conversation_count", len(ids),
					"storage_mode", "single",
					"conversation_id", conversationID,
					"err", err.Error(),
				)
				recordQuerySpanError(span, err)
				return nil, nil, err
			}
			if row == nil {
				missing = append(missing, conversationID)
				continue
			}
			rowsByID[conversationID] = *row
		}
	}

	ratingSummaries := make(map[string]feedback.ConversationRatingSummary)
	annotationSummaries := make(map[string]feedback.ConversationAnnotationSummary)
	evalSummaries := make(map[string]evalpkg.ConversationEvalSummary)
	if len(rowsByID) > 0 {
		lookupIDs := make([]string, 0, len(rowsByID))
		for conversationID := range rowsByID {
			lookupIDs = append(lookupIDs, conversationID)
		}
		sort.Strings(lookupIDs)

		if s.ratingSummaryStore != nil {
			summaries, err := s.ratingSummaryStore.ListConversationRatingSummaries(ctx, trimmedTenantID, lookupIDs)
			if err != nil {
				s.errorLog(
					"conversation_rating_summary_load_failed",
					"tenant_id", trimmedTenantID,
					"requested_conversation_count", len(lookupIDs),
					"err", err.Error(),
				)
				recordQuerySpanError(span, err)
				return nil, nil, err
			}
			ratingSummaries = summaries
		}
		if s.annotationSummaryStore != nil {
			summaries, err := s.annotationSummaryStore.ListConversationAnnotationSummaries(ctx, trimmedTenantID, lookupIDs)
			if err != nil {
				s.errorLog(
					"conversation_annotation_summary_load_failed",
					"tenant_id", trimmedTenantID,
					"requested_conversation_count", len(lookupIDs),
					"err", err.Error(),
				)
				recordQuerySpanError(span, err)
				return nil, nil, err
			}
			annotationSummaries = summaries
		}
		if s.evalSummaryStore != nil {
			summaries, err := s.evalSummaryStore.ListConversationEvalSummaries(ctx, trimmedTenantID, lookupIDs)
			if err != nil {
				s.errorLog(
					"conversation_eval_summary_load_failed",
					"tenant_id", trimmedTenantID,
					"requested_conversation_count", len(lookupIDs),
					"err", err.Error(),
				)
				recordQuerySpanError(span, err)
				return nil, nil, err
			}
			evalSummaries = summaries
		}
	}

	items := make([]ConversationBatchMetadata, 0, len(rowsByID))
	for _, conversationID := range ids {
		row, ok := rowsByID[conversationID]
		if !ok {
			continue
		}
		item := ConversationBatchMetadata{
			ConversationID:    conversationID,
			ConversationTitle: row.ConversationTitle,
			UserID:            row.UserID,
			GenerationCount:   row.GenerationCount,
			FirstGenerationAt: row.FirstGenerationAt.UTC(),
			LastGenerationAt:  row.LastGenerationAt.UTC(),
			Models:            append([]string{}, row.Models...),
			ModelProviders:    cloneStringMap(row.ModelProviders),
			Agents:            append([]string{}, row.Agents...),
			ErrorCount:        row.ErrorCount,
			HasErrors:         row.ErrorCount > 0,
			InputTokens:       row.InputTokens,
			OutputTokens:      row.OutputTokens,
			CacheReadTokens:   row.CacheReadTokens,
			CacheWriteTokens:  row.CacheWriteTokens,
			ReasoningTokens:   row.ReasoningTokens,
			TotalTokens:       row.TotalTokens,
			AnnotationCount:   annotationSummaries[conversationID].AnnotationCount,
		}
		if summary, ok := ratingSummaries[conversationID]; ok {
			copied := summary
			item.RatingSummary = &copied
		}
		if summary, ok := evalSummaries[conversationID]; ok {
			copied := summary
			item.EvalSummary = &copied
		}
		items = append(items, item)
	}

	span.SetAttributes(
		attribute.Int("sigil.query.result_count", len(items)),
		attribute.Int("sigil.query.missing_count", len(missing)),
	)
	return items, missing, nil
}

func (s *Service) ListSearchTagValuesForTenant(ctx context.Context, tenantID, tag string, from, to time.Time) ([]string, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.list_search_tag_values")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTag := strings.TrimSpace(tag)
	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.String("sigil.query.tag", trimmedTag),
	)
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return nil, err
	}
	if s.tempoClient == nil {
		err := errors.New("tempo client is not configured")
		recordQuerySpanError(span, err)
		return nil, err
	}

	tempoTag, mysqlOnly, err := resolveTagKeyForTempo(tag)
	if err != nil {
		validationErr := NewValidationError(err.Error())
		recordQuerySpanError(span, validationErr)
		return nil, validationErr
	}
	if !mysqlOnly && strings.TrimSpace(tempoTag) == "" {
		validationErr := NewValidationError(fmt.Sprintf("invalid tag %q", strings.TrimSpace(tag)))
		s.debugLog("search_tag_values_error",
			"requested_tag", strings.TrimSpace(tag),
			"resolved_tempo_tag", tempoTag,
			"error", validationErr.Error(),
		)
		recordQuerySpanError(span, validationErr)
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
		span.SetAttributes(attribute.Int("sigil.query.result_count", 0))
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
		recordQuerySpanError(span, err)
		return nil, err
	}
	s.debugLog("search_tag_values_done",
		"requested_tag", strings.TrimSpace(tag),
		"resolved_tempo_tag", tempoTag,
		"values_count", len(values),
	)
	span.SetAttributes(attribute.Int("sigil.query.result_count", len(values)))
	return values, nil
}

func (s *Service) loadConversationSearchMetadata(
	ctx context.Context,
	tenantID string,
	conversationIDs []string,
) (map[string]storage.Conversation, map[string]feedback.ConversationRatingSummary, map[string]feedback.ConversationAnnotationSummary, map[string]evalpkg.ConversationEvalSummary, error) {
	uniqueConversationIDs := dedupeAndSortStrings(conversationIDs)
	metadata := make(map[string]storage.Conversation, len(uniqueConversationIDs))
	ratingSummaries := make(map[string]feedback.ConversationRatingSummary)
	annotationSummaries := make(map[string]feedback.ConversationAnnotationSummary)
	evalSummaries := make(map[string]evalpkg.ConversationEvalSummary)
	if len(uniqueConversationIDs) == 0 {
		return metadata, ratingSummaries, annotationSummaries, evalSummaries, nil
	}

	items, _, err := s.ListConversationBatchMetadataForTenant(ctx, tenantID, uniqueConversationIDs)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	for _, item := range items {
		metadata[item.ConversationID] = storage.Conversation{
			TenantID:          tenantID,
			ConversationID:    item.ConversationID,
			ConversationTitle: item.ConversationTitle,
			UserID:            item.UserID,
			FirstGenerationAt: item.FirstGenerationAt.UTC(),
			LastGenerationAt:  item.LastGenerationAt.UTC(),
			GenerationCount:   item.GenerationCount,
			Models:            append([]string{}, item.Models...),
			ModelProviders:    cloneStringMap(item.ModelProviders),
			Agents:            append([]string{}, item.Agents...),
			ErrorCount:        item.ErrorCount,
			InputTokens:       item.InputTokens,
			OutputTokens:      item.OutputTokens,
			CacheReadTokens:   item.CacheReadTokens,
			CacheWriteTokens:  item.CacheWriteTokens,
			ReasoningTokens:   item.ReasoningTokens,
			TotalTokens:       item.TotalTokens,
		}
		if item.RatingSummary != nil {
			ratingSummaries[item.ConversationID] = *item.RatingSummary
		}
		annotationSummaries[item.ConversationID] = feedback.ConversationAnnotationSummary{
			AnnotationCount: item.AnnotationCount,
		}
		if item.EvalSummary != nil {
			evalSummaries[item.ConversationID] = *item.EvalSummary
		}
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
	if err := searchcore.ValidateMySQLFilterTerms(terms); err != nil {
		return NewValidationError(err.Error())
	}
	return nil
}

func matchesMySQLFilters(conversation storage.Conversation, terms []FilterTerm) bool {
	return searchcore.MatchesGenerationCountFilters(conversation.GenerationCount, terms)
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

func buildSelectedResultMapWithConversationMetadata(
	selected map[string]*tempoSelectedAggregation,
	conversation storage.Conversation,
	selectFields []SelectField,
) map[string]any {
	out := buildSelectedResultMap(selected)
	for _, field := range selectFields {
		if strings.TrimSpace(field.Key) == "" {
			continue
		}
		if out == nil {
			out = make(map[string]any, len(selectFields))
		}
		switch strings.TrimSpace(field.ResolvedKey) {
		case "span.gen_ai.usage.input_tokens":
			out[field.Key] = float64(conversation.InputTokens)
		case "span.gen_ai.usage.output_tokens":
			out[field.Key] = float64(conversation.OutputTokens)
		case "span.gen_ai.usage.cache_read_input_tokens":
			out[field.Key] = float64(conversation.CacheReadTokens)
		case "span.gen_ai.usage.cache_write_input_tokens":
			out[field.Key] = float64(conversation.CacheWriteTokens)
		case "span.gen_ai.usage.reasoning_tokens":
			out[field.Key] = float64(conversation.ReasoningTokens)
		}
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

	descriptor, err := agentmeta.BuildDescriptor(generation)
	if err != nil {
		return nil, fmt.Errorf("build agent descriptor: %w", err)
	}
	if descriptor.AgentName != "" {
		payload["agent_effective_version"] = descriptor.EffectiveVersion
		payload["agent_id"] = descriptor.AgentName
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
		if score.EvaluatorDescription != "" {
			entry["evaluator_description"] = score.EvaluatorDescription
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

func latestConversationUserID(generations []*sigilv1.Generation) string {
	var userID string
	var latestAt time.Time
	bestIndex := -1
	found := false
	for idx, generation := range generations {
		candidate := storage.GenerationMetadataFirstString(
			generation,
			generationMetadataUserIDKey,
			generationMetadataLegacyUserIDKey,
		)
		if candidate == "" {
			continue
		}
		candidateAt := generationTimestamp(generation)
		if !found || candidateAt.After(latestAt) || (candidateAt.Equal(latestAt) && idx > bestIndex) {
			userID = candidate
			latestAt = candidateAt
			bestIndex = idx
			found = true
		}
	}
	return userID
}

func (s *Service) batchResolveGenerationTitles(
	ctx context.Context,
	tenantID string,
	candidates []searchCandidate,
	reader storage.GenerationFanOutReader,
	cache map[string]generationTitleSnapshot,
) []string {
	titles := make([]string, len(candidates))
	if reader == nil || len(candidates) == 0 {
		return titles
	}

	type titleResult struct {
		index        int
		title        string
		cacheEntries map[string]generationTitleSnapshot
	}

	resultCh := make(chan titleResult, len(candidates))

	cacheSnapshot := make(map[string]generationTitleSnapshot, len(cache))
	for k, v := range cache {
		cacheSnapshot[k] = v
	}

	var wg sync.WaitGroup
	for i, candidate := range candidates {
		wg.Add(1)
		go func(idx int, c searchCandidate) {
			defer wg.Done()
			localCache := make(map[string]generationTitleSnapshot, len(cacheSnapshot))
			for k, v := range cacheSnapshot {
				localCache[k] = v
			}
			title := s.resolveLatestConversationTitleFromGenerations(ctx, tenantID, c.metadata, reader, localCache)
			if title == "" {
				title = s.resolveConversationTitleFromGenerationIDs(ctx, tenantID, c.aggregate.GenerationIDs, reader, localCache)
			}
			resultCh <- titleResult{index: idx, title: title, cacheEntries: localCache}
		}(i, candidate)
	}

	go func() {
		wg.Wait()
		close(resultCh)
	}()

	for result := range resultCh {
		titles[result.index] = result.title
		for k, v := range result.cacheEntries {
			cache[k] = v
		}
	}

	return titles
}

func (s *Service) resolveConversationTitleFromGenerationIDs(
	ctx context.Context,
	tenantID string,
	generationIDs map[string]struct{},
	reader storage.GenerationFanOutReader,
	cache map[string]generationTitleSnapshot,
) string {
	if reader == nil || len(generationIDs) == 0 {
		return ""
	}

	var (
		title         string
		latestAt      time.Time
		bestIndex     int
		foundSnapshot bool
	)
	generationIDList := sortedKeysFromSet(generationIDs)
	for idx, generationID := range generationIDList {
		snapshot, ok := cache[generationID]
		if !ok {
			generation, err := reader.GetGenerationByID(ctx, tenantID, generationID)
			if err != nil {
				s.debugLog(
					"search_conversation_title_lookup_failed",
					"tenant_id",
					tenantID,
					"generation_id",
					generationID,
					"err",
					err.Error(),
				)
				cache[generationID] = generationTitleSnapshot{}
				continue
			}
			snapshot = generationTitleSnapshot{
				Title:     storage.ConversationTitleFromGeneration(generation),
				Timestamp: generationTimestamp(generation),
			}
			cache[generationID] = snapshot
		}
		if snapshot.Title == "" {
			continue
		}
		if !foundSnapshot || snapshot.Timestamp.After(latestAt) || (snapshot.Timestamp.Equal(latestAt) && idx > bestIndex) {
			title = snapshot.Title
			latestAt = snapshot.Timestamp
			bestIndex = idx
			foundSnapshot = true
		}
	}
	return title
}

func (s *Service) resolveLatestConversationTitleFromGenerations(
	ctx context.Context,
	tenantID string,
	conversation storage.Conversation,
	reader storage.GenerationFanOutReader,
	cache map[string]generationTitleSnapshot,
) string {
	if reader == nil {
		return ""
	}

	conversationID := strings.TrimSpace(conversation.ConversationID)
	if conversationID == "" {
		return ""
	}

	var (
		generations []*sigilv1.Generation
		err         error
	)
	if plannedReader, ok := reader.(plannedConversationFanOutReader); ok {
		plan := storage.ConversationReadPlan{
			ExpectedGenerationCount: conversation.GenerationCount,
		}
		if !conversation.LastGenerationAt.IsZero() {
			plan.To = conversation.LastGenerationAt.UTC().Add(2 * time.Minute)
		}
		generations, err = plannedReader.ListConversationGenerationsWithPlan(ctx, tenantID, conversationID, plan)
	} else {
		generations, err = reader.ListConversationGenerations(ctx, tenantID, conversationID)
	}
	if err != nil {
		s.debugLog(
			"search_conversation_title_lookup_failed",
			"tenant_id",
			tenantID,
			"conversation_id",
			conversationID,
			"err",
			err.Error(),
		)
		return ""
	}
	if len(generations) == 0 {
		return ""
	}

	var (
		title         string
		latestAt      time.Time
		bestIndex     int
		foundSnapshot bool
	)
	for idx, generation := range generations {
		if generation == nil {
			continue
		}
		generationID := strings.TrimSpace(generation.GetId())
		snapshot, cached := cache[generationID]
		if !cached {
			snapshot = generationTitleSnapshot{
				Title:     storage.ConversationTitleFromGeneration(generation),
				Timestamp: generationTimestamp(generation),
			}
			if generationID != "" {
				cache[generationID] = snapshot
			}
		}
		if snapshot.Title == "" {
			continue
		}
		if !foundSnapshot || snapshot.Timestamp.After(latestAt) || (snapshot.Timestamp.Equal(latestAt) && idx > bestIndex) {
			title = snapshot.Title
			latestAt = snapshot.Timestamp
			bestIndex = idx
			foundSnapshot = true
		}
	}
	return title
}

func normalizeTempoTagKey(scope string, key string) string {
	return searchcore.NormalizeTempoTagKey(scope, key)
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
