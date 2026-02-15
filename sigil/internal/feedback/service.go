package feedback

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

const (
	DefaultPageLimit = 50
	MaxPageLimit     = 200

	maxConversationIDLen = 255
	maxEventIDLen        = 128
	maxGenerationIDLen   = 255
	maxActorIDLen        = 255
	maxSourceLen         = 64
	maxCommentBytes      = 4096
	maxAnnotationBytes   = 8192
	maxMetadataBytes     = 16 * 1024
	maxTagsBytes         = 4 * 1024
)

const (
	HeaderOperatorID    = "X-Sigil-Operator-Id"
	HeaderOperatorLogin = "X-Sigil-Operator-Login"
	HeaderOperatorName  = "X-Sigil-Operator-Name"
)

const (
	RatingValueGood = "CONVERSATION_RATING_VALUE_GOOD"
	RatingValueBad  = "CONVERSATION_RATING_VALUE_BAD"
)

const (
	AnnotationTypeNote      = "NOTE"
	AnnotationTypeLabel     = "LABEL"
	AnnotationTypeTriage    = "TRIAGE_STATUS"
	AnnotationTypeRootCause = "ROOT_CAUSE"
	AnnotationTypeFollowUp  = "FOLLOW_UP"
)

var (
	ErrConflict = errors.New("idempotency conflict")
)

var (
	feedbackRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_conversation_feedback_requests_total",
		Help: "Total number of conversation feedback API requests by kind, operation, and status.",
	}, []string{"kind", "op", "status"})
	feedbackRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_conversation_feedback_request_duration_seconds",
		Help:    "Conversation feedback API request duration by kind and operation.",
		Buckets: prometheus.DefBuckets,
	}, []string{"kind", "op"})
)

type ValidationError struct {
	msg string
}

func (e *ValidationError) Error() string {
	return e.msg
}

func newValidationError(msg string) error {
	return &ValidationError{msg: msg}
}

func NewValidationError(msg string) error {
	return newValidationError(msg)
}

func IsValidationError(err error) bool {
	var validationErr *ValidationError
	return errors.As(err, &validationErr)
}

type OperatorIdentity struct {
	OperatorID    string
	OperatorLogin string
	OperatorName  string
}

type ConversationRating struct {
	RatingID       string         `json:"rating_id"`
	ConversationID string         `json:"conversation_id"`
	GenerationID   string         `json:"generation_id,omitempty"`
	Rating         string         `json:"rating"`
	Comment        string         `json:"comment,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	RaterID        string         `json:"rater_id,omitempty"`
	Source         string         `json:"source,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}

type ConversationRatingSummary struct {
	TotalCount    int       `json:"total_count"`
	GoodCount     int       `json:"good_count"`
	BadCount      int       `json:"bad_count"`
	LatestRating  string    `json:"latest_rating,omitempty"`
	LatestRatedAt time.Time `json:"latest_rated_at"`
	LatestBadAt   time.Time `json:"latest_bad_at,omitempty"`
	HasBadRating  bool      `json:"has_bad_rating"`
}

type CreateConversationRatingInput struct {
	RatingID     string         `json:"rating_id"`
	Rating       string         `json:"rating"`
	Comment      string         `json:"comment"`
	Metadata     map[string]any `json:"metadata"`
	GenerationID string         `json:"generation_id"`
	RaterID      string         `json:"rater_id"`
	Source       string         `json:"source"`
}

type ConversationAnnotation struct {
	AnnotationID   string            `json:"annotation_id"`
	ConversationID string            `json:"conversation_id"`
	GenerationID   string            `json:"generation_id,omitempty"`
	AnnotationType string            `json:"annotation_type"`
	Body           string            `json:"body,omitempty"`
	Tags           map[string]string `json:"tags,omitempty"`
	Metadata       map[string]any    `json:"metadata,omitempty"`
	OperatorID     string            `json:"operator_id"`
	OperatorLogin  string            `json:"operator_login,omitempty"`
	OperatorName   string            `json:"operator_name,omitempty"`
	CreatedAt      time.Time         `json:"created_at"`
}

type ConversationAnnotationSummary struct {
	AnnotationCount      int       `json:"annotation_count"`
	LatestAnnotationType string    `json:"latest_annotation_type,omitempty"`
	LatestAnnotatedAt    time.Time `json:"latest_annotated_at"`
}

type CreateConversationAnnotationInput struct {
	AnnotationID   string            `json:"annotation_id"`
	AnnotationType string            `json:"annotation_type"`
	Body           string            `json:"body"`
	Tags           map[string]string `json:"tags"`
	Metadata       map[string]any    `json:"metadata"`
	GenerationID   string            `json:"generation_id"`
}

type Store interface {
	CreateConversationRating(ctx context.Context, tenantID, conversationID string, input CreateConversationRatingInput) (*ConversationRating, *ConversationRatingSummary, error)
	ListConversationRatings(ctx context.Context, tenantID, conversationID string, limit int, cursor uint64) ([]ConversationRating, uint64, error)
	GetConversationRatingSummary(ctx context.Context, tenantID, conversationID string) (*ConversationRatingSummary, error)
	ListConversationRatingSummaries(ctx context.Context, tenantID string, conversationIDs []string) (map[string]ConversationRatingSummary, error)
	CreateConversationAnnotation(ctx context.Context, tenantID, conversationID string, operator OperatorIdentity, input CreateConversationAnnotationInput) (*ConversationAnnotation, *ConversationAnnotationSummary, error)
	ListConversationAnnotations(ctx context.Context, tenantID, conversationID string, limit int, cursor uint64) ([]ConversationAnnotation, uint64, error)
	GetConversationAnnotationSummary(ctx context.Context, tenantID, conversationID string) (*ConversationAnnotationSummary, error)
	ListConversationAnnotationSummaries(ctx context.Context, tenantID string, conversationIDs []string) (map[string]ConversationAnnotationSummary, error)
}

type Service struct {
	store Store
}

func NewService(store Store) *Service {
	return &Service{store: store}
}

func (s *Service) CreateRating(ctx context.Context, tenantID, conversationID string, input CreateConversationRatingInput) (*ConversationRating, *ConversationRatingSummary, error) {
	start := time.Now()
	status := "success"
	defer func() {
		observeFeedbackMetrics("rating", "create", status, start)
	}()

	if s.store == nil {
		status = "error"
		return nil, nil, errors.New("rating store is required")
	}
	normalized, err := normalizeAndValidateCreateRating(conversationID, input)
	if err != nil {
		status = classifyFeedbackErrorStatus(err)
		return nil, nil, err
	}
	rating, summary, err := s.store.CreateConversationRating(ctx, strings.TrimSpace(tenantID), normalized.ConversationID, normalized.Input)
	if err != nil {
		status = classifyFeedbackErrorStatus(err)
		return nil, nil, err
	}
	return rating, summary, nil
}

func (s *Service) ListRatings(ctx context.Context, tenantID, conversationID string, limit int, cursor uint64) ([]ConversationRating, uint64, error) {
	start := time.Now()
	status := "success"
	defer func() {
		observeFeedbackMetrics("rating", "list", status, start)
	}()

	if s.store == nil {
		status = "error"
		return nil, 0, errors.New("rating store is required")
	}
	normalizedConversationID := strings.TrimSpace(conversationID)
	if normalizedConversationID == "" {
		status = "validation_error"
		return nil, 0, newValidationError("conversation id is required")
	}
	if len(normalizedConversationID) > maxConversationIDLen {
		status = "validation_error"
		return nil, 0, newValidationError("conversation id is too long")
	}
	pageLimit := normalizeLimit(limit)
	items, nextCursor, err := s.store.ListConversationRatings(ctx, strings.TrimSpace(tenantID), normalizedConversationID, pageLimit, cursor)
	if err != nil {
		status = classifyFeedbackErrorStatus(err)
		return nil, 0, err
	}
	return items, nextCursor, nil
}

func (s *Service) CreateAnnotation(ctx context.Context, tenantID, conversationID string, operator OperatorIdentity, input CreateConversationAnnotationInput) (*ConversationAnnotation, *ConversationAnnotationSummary, error) {
	start := time.Now()
	status := "success"
	defer func() {
		observeFeedbackMetrics("annotation", "create", status, start)
	}()

	if s.store == nil {
		status = "error"
		return nil, nil, errors.New("annotation store is required")
	}
	normalized, err := normalizeAndValidateCreateAnnotation(conversationID, operator, input)
	if err != nil {
		status = classifyFeedbackErrorStatus(err)
		return nil, nil, err
	}
	annotation, summary, err := s.store.CreateConversationAnnotation(ctx, strings.TrimSpace(tenantID), normalized.ConversationID, normalized.Operator, normalized.Input)
	if err != nil {
		status = classifyFeedbackErrorStatus(err)
		return nil, nil, err
	}
	return annotation, summary, nil
}

func (s *Service) ListAnnotations(ctx context.Context, tenantID, conversationID string, limit int, cursor uint64) ([]ConversationAnnotation, uint64, error) {
	start := time.Now()
	status := "success"
	defer func() {
		observeFeedbackMetrics("annotation", "list", status, start)
	}()

	if s.store == nil {
		status = "error"
		return nil, 0, errors.New("annotation store is required")
	}
	normalizedConversationID := strings.TrimSpace(conversationID)
	if normalizedConversationID == "" {
		status = "validation_error"
		return nil, 0, newValidationError("conversation id is required")
	}
	if len(normalizedConversationID) > maxConversationIDLen {
		status = "validation_error"
		return nil, 0, newValidationError("conversation id is too long")
	}
	pageLimit := normalizeLimit(limit)
	items, nextCursor, err := s.store.ListConversationAnnotations(ctx, strings.TrimSpace(tenantID), normalizedConversationID, pageLimit, cursor)
	if err != nil {
		status = classifyFeedbackErrorStatus(err)
		return nil, 0, err
	}
	return items, nextCursor, nil
}

func NormalizeCursor(rawCursor string) (uint64, error) {
	trimmed := strings.TrimSpace(rawCursor)
	if trimmed == "" {
		return 0, nil
	}
	cursor, err := strconv.ParseUint(trimmed, 10, 64)
	if err != nil {
		return 0, newValidationError("invalid cursor")
	}
	return cursor, nil
}

func NormalizeLimit(rawLimit string) (int, error) {
	trimmed := strings.TrimSpace(rawLimit)
	if trimmed == "" {
		return DefaultPageLimit, nil
	}
	parsed, err := strconv.Atoi(trimmed)
	if err != nil || parsed <= 0 {
		return 0, newValidationError("invalid limit")
	}
	return normalizeLimit(parsed), nil
}

type normalizedCreateRating struct {
	ConversationID string
	Input          CreateConversationRatingInput
}

func normalizeAndValidateCreateRating(conversationID string, input CreateConversationRatingInput) (normalizedCreateRating, error) {
	normalized := normalizedCreateRating{
		ConversationID: strings.TrimSpace(conversationID),
		Input: CreateConversationRatingInput{
			RatingID:     strings.TrimSpace(input.RatingID),
			Rating:       strings.TrimSpace(input.Rating),
			Comment:      strings.TrimSpace(input.Comment),
			Metadata:     input.Metadata,
			GenerationID: strings.TrimSpace(input.GenerationID),
			RaterID:      strings.TrimSpace(input.RaterID),
			Source:       strings.TrimSpace(input.Source),
		},
	}

	if normalized.ConversationID == "" {
		return normalizedCreateRating{}, newValidationError("conversation id is required")
	}
	if len(normalized.ConversationID) > maxConversationIDLen {
		return normalizedCreateRating{}, newValidationError("conversation id is too long")
	}
	if normalized.Input.RatingID == "" {
		return normalizedCreateRating{}, newValidationError("rating id is required")
	}
	if len(normalized.Input.RatingID) > maxEventIDLen {
		return normalizedCreateRating{}, newValidationError("rating id is too long")
	}
	if normalized.Input.Rating != RatingValueGood && normalized.Input.Rating != RatingValueBad {
		return normalizedCreateRating{}, newValidationError("rating must be CONVERSATION_RATING_VALUE_GOOD or CONVERSATION_RATING_VALUE_BAD")
	}
	if len(normalized.Input.Comment) > maxCommentBytes {
		return normalizedCreateRating{}, newValidationError("comment is too long")
	}
	if len(normalized.Input.GenerationID) > maxGenerationIDLen {
		return normalizedCreateRating{}, newValidationError("generation id is too long")
	}
	if len(normalized.Input.RaterID) > maxActorIDLen {
		return normalizedCreateRating{}, newValidationError("rater id is too long")
	}
	if len(normalized.Input.Source) > maxSourceLen {
		return normalizedCreateRating{}, newValidationError("source is too long")
	}
	if err := validateMetadataSize(normalized.Input.Metadata, maxMetadataBytes, "metadata"); err != nil {
		return normalizedCreateRating{}, err
	}
	return normalized, nil
}

type normalizedCreateAnnotation struct {
	ConversationID string
	Operator       OperatorIdentity
	Input          CreateConversationAnnotationInput
}

func normalizeAndValidateCreateAnnotation(conversationID string, operator OperatorIdentity, input CreateConversationAnnotationInput) (normalizedCreateAnnotation, error) {
	normalized := normalizedCreateAnnotation{
		ConversationID: strings.TrimSpace(conversationID),
		Operator: OperatorIdentity{
			OperatorID:    strings.TrimSpace(operator.OperatorID),
			OperatorLogin: strings.TrimSpace(operator.OperatorLogin),
			OperatorName:  strings.TrimSpace(operator.OperatorName),
		},
		Input: CreateConversationAnnotationInput{
			AnnotationID:   strings.TrimSpace(input.AnnotationID),
			AnnotationType: strings.TrimSpace(input.AnnotationType),
			Body:           strings.TrimSpace(input.Body),
			Tags:           input.Tags,
			Metadata:       input.Metadata,
			GenerationID:   strings.TrimSpace(input.GenerationID),
		},
	}

	if normalized.ConversationID == "" {
		return normalizedCreateAnnotation{}, newValidationError("conversation id is required")
	}
	if len(normalized.ConversationID) > maxConversationIDLen {
		return normalizedCreateAnnotation{}, newValidationError("conversation id is too long")
	}
	if normalized.Operator.OperatorID == "" {
		return normalizedCreateAnnotation{}, newValidationError("operator id header is required")
	}
	if len(normalized.Operator.OperatorID) > maxActorIDLen {
		return normalizedCreateAnnotation{}, newValidationError("operator id is too long")
	}
	if len(normalized.Operator.OperatorLogin) > maxActorIDLen {
		return normalizedCreateAnnotation{}, newValidationError("operator login is too long")
	}
	if len(normalized.Operator.OperatorName) > maxActorIDLen {
		return normalizedCreateAnnotation{}, newValidationError("operator name is too long")
	}
	if normalized.Input.AnnotationID == "" {
		return normalizedCreateAnnotation{}, newValidationError("annotation id is required")
	}
	if len(normalized.Input.AnnotationID) > maxEventIDLen {
		return normalizedCreateAnnotation{}, newValidationError("annotation id is too long")
	}
	switch normalized.Input.AnnotationType {
	case AnnotationTypeNote, AnnotationTypeLabel, AnnotationTypeTriage, AnnotationTypeRootCause, AnnotationTypeFollowUp:
	default:
		return normalizedCreateAnnotation{}, newValidationError("annotation type is invalid")
	}
	if len(normalized.Input.Body) > maxAnnotationBytes {
		return normalizedCreateAnnotation{}, newValidationError("annotation body is too long")
	}
	if len(normalized.Input.GenerationID) > maxGenerationIDLen {
		return normalizedCreateAnnotation{}, newValidationError("generation id is too long")
	}
	if err := validateMetadataSize(normalized.Input.Metadata, maxMetadataBytes, "metadata"); err != nil {
		return normalizedCreateAnnotation{}, err
	}
	if err := validateMetadataSize(normalized.Input.Tags, maxTagsBytes, "tags"); err != nil {
		return normalizedCreateAnnotation{}, err
	}
	return normalized, nil
}

func validateMetadataSize(value any, maxBytes int, fieldName string) error {
	if value == nil {
		return nil
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return newValidationError(fmt.Sprintf("%s must be valid JSON", fieldName))
	}
	if len(payload) > maxBytes {
		return newValidationError(fmt.Sprintf("%s is too large", fieldName))
	}
	return nil
}

func normalizeLimit(limit int) int {
	if limit <= 0 {
		return DefaultPageLimit
	}
	if limit > MaxPageLimit {
		return MaxPageLimit
	}
	return limit
}

func classifyFeedbackErrorStatus(err error) string {
	if err == nil {
		return "success"
	}
	if errors.Is(err, ErrConflict) {
		return "conflict"
	}
	if IsValidationError(err) {
		return "validation_error"
	}
	return "error"
}

func observeFeedbackMetrics(kind, op, status string, start time.Time) {
	feedbackRequestsTotal.WithLabelValues(kind, op, status).Inc()
	feedbackRequestDuration.WithLabelValues(kind, op).Observe(time.Since(start).Seconds())
}
