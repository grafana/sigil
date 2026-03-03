package ingest

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/worker"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

type GenerationLookup interface {
	GetByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error)
}

type ScoreValue struct {
	Number *float64 `json:"number,omitempty"`
	Bool   *bool    `json:"bool,omitempty"`
	String *string  `json:"string,omitempty"`
}

type ScoreSource struct {
	Kind string `json:"kind,omitempty"`
	ID   string `json:"id,omitempty"`
}

type ScoreItem struct {
	ScoreID          string         `json:"score_id"`
	GenerationID     string         `json:"generation_id"`
	ConversationID   string         `json:"conversation_id,omitempty"`
	TraceID          string         `json:"trace_id,omitempty"`
	SpanID           string         `json:"span_id,omitempty"`
	EvaluatorID      string         `json:"evaluator_id"`
	EvaluatorVersion string         `json:"evaluator_version"`
	RuleID           string         `json:"rule_id,omitempty"`
	RunID            string         `json:"run_id,omitempty"`
	ScoreKey         string         `json:"score_key"`
	Value            ScoreValue     `json:"value"`
	Passed           *bool          `json:"passed,omitempty"`
	Explanation      string         `json:"explanation,omitempty"`
	Metadata         map[string]any `json:"metadata,omitempty"`
	CreatedAt        time.Time      `json:"created_at,omitempty"`
	Source           ScoreSource    `json:"source,omitempty"`
}

type ExportScoresRequest struct {
	Scores []ScoreItem `json:"scores"`
}

type ExportScoreResult struct {
	ScoreID  string `json:"score_id"`
	Accepted bool   `json:"accepted"`
	Error    string `json:"error,omitempty"`
}

type ExportScoresResponse struct {
	Results []ExportScoreResult `json:"results"`
}

type Service struct {
	store                  ingestStore
	generationLookup       GenerationLookup
	allowMissingGeneration bool
}

type ingestStore interface {
	InsertScore(ctx context.Context, score evalpkg.GenerationScore) (bool, error)
}

func NewService(store ingestStore, generationLookup GenerationLookup, allowMissingGeneration bool) *Service {
	return &Service{
		store:                  store,
		generationLookup:       generationLookup,
		allowMissingGeneration: allowMissingGeneration,
	}
}

func (s *Service) Export(ctx context.Context, tenantID string, request ExportScoresRequest) ExportScoresResponse {
	transport := transportFromContext(ctx)
	observeScoreIngestBatch(transport, len(request.Scores))

	response := ExportScoresResponse{Results: make([]ExportScoreResult, 0, len(request.Scores))}
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		for _, item := range request.Scores {
			response.Results = append(response.Results, ExportScoreResult{ScoreID: item.ScoreID, Accepted: false, Error: "tenant id is required"})
			observeScoreIngestItem("", false, "tenant_missing", transport)
		}
		return response
	}
	if s.store == nil {
		for _, item := range request.Scores {
			response.Results = append(response.Results, ExportScoreResult{ScoreID: item.ScoreID, Accepted: false, Error: "eval store is required"})
			observeScoreIngestItem(trimmedTenantID, false, "store_unavailable", transport)
		}
		return response
	}

	for _, item := range request.Scores {
		result := ExportScoreResult{ScoreID: item.ScoreID}
		score, err := normalizeAndValidateScoreItem(trimmedTenantID, item)
		if err != nil {
			result.Error = err.Error()
			worker.ObserveScoreIngestError(trimmedTenantID, "validation")
			response.Results = append(response.Results, result)
			observeScoreIngestItem(trimmedTenantID, false, "validation", transport)
			continue
		}

		if !s.allowMissingGeneration && s.generationLookup != nil {
			generation, err := s.generationLookup.GetByID(ctx, trimmedTenantID, score.GenerationID)
			if err != nil {
				result.Error = fmt.Sprintf("generation lookup failed: %v", err)
				worker.ObserveScoreIngestError(trimmedTenantID, "generation_lookup")
				response.Results = append(response.Results, result)
				observeScoreIngestItem(trimmedTenantID, false, "generation_lookup", transport)
				continue
			}
			if generation == nil {
				result.Error = "generation_id was not found"
				worker.ObserveScoreIngestError(trimmedTenantID, "generation_not_found")
				response.Results = append(response.Results, result)
				observeScoreIngestItem(trimmedTenantID, false, "generation_not_found", transport)
				continue
			}
		}

		_, err = s.store.InsertScore(ctx, score)
		if err != nil {
			result.Error = err.Error()
			worker.ObserveScoreIngestError(trimmedTenantID, "insert")
			response.Results = append(response.Results, result)
			observeScoreIngestItem(trimmedTenantID, false, "insert_error", transport)
			continue
		}

		result.Accepted = true
		source := "external_api"
		if score.SourceKind != "" {
			source = score.SourceKind
		}
		worker.ObserveScoreIngest(trimmedTenantID, source)
		response.Results = append(response.Results, result)
		observeScoreIngestItem(trimmedTenantID, true, "none", transport)
	}

	return response
}

func normalizeAndValidateScoreItem(tenantID string, item ScoreItem) (evalpkg.GenerationScore, error) {
	if strings.TrimSpace(item.ScoreID) == "" {
		return evalpkg.GenerationScore{}, errors.New("score_id is required")
	}
	if strings.TrimSpace(item.GenerationID) == "" {
		return evalpkg.GenerationScore{}, errors.New("generation_id is required")
	}
	if strings.TrimSpace(item.EvaluatorID) == "" {
		return evalpkg.GenerationScore{}, errors.New("evaluator_id is required")
	}
	if strings.TrimSpace(item.EvaluatorVersion) == "" {
		return evalpkg.GenerationScore{}, errors.New("evaluator_version is required")
	}
	if strings.TrimSpace(item.ScoreKey) == "" {
		return evalpkg.GenerationScore{}, errors.New("score_key is required")
	}

	nonNilValues := 0
	scoreValue := evalpkg.ScoreValue{}
	scoreType := evalpkg.ScoreType("")
	if item.Value.Number != nil {
		nonNilValues++
		scoreType = evalpkg.ScoreTypeNumber
		scoreValue.Number = item.Value.Number
	}
	if item.Value.Bool != nil {
		nonNilValues++
		scoreType = evalpkg.ScoreTypeBool
		scoreValue.Bool = item.Value.Bool
	}
	if item.Value.String != nil {
		nonNilValues++
		scoreType = evalpkg.ScoreTypeString
		scoreValue.String = item.Value.String
	}
	if nonNilValues == 0 {
		return evalpkg.GenerationScore{}, errors.New("score value is required")
	}
	if nonNilValues > 1 {
		return evalpkg.GenerationScore{}, errors.New("score value must contain exactly one type")
	}

	createdAt := item.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}

	return evalpkg.GenerationScore{
		TenantID:         tenantID,
		ScoreID:          strings.TrimSpace(item.ScoreID),
		GenerationID:     strings.TrimSpace(item.GenerationID),
		ConversationID:   strings.TrimSpace(item.ConversationID),
		TraceID:          strings.TrimSpace(item.TraceID),
		SpanID:           strings.TrimSpace(item.SpanID),
		EvaluatorID:      strings.TrimSpace(item.EvaluatorID),
		EvaluatorVersion: strings.TrimSpace(item.EvaluatorVersion),
		RuleID:           strings.TrimSpace(item.RuleID),
		RunID:            strings.TrimSpace(item.RunID),
		ScoreKey:         strings.TrimSpace(item.ScoreKey),
		ScoreType:        scoreType,
		Value:            scoreValue,
		Passed:           item.Passed,
		Explanation:      strings.TrimSpace(item.Explanation),
		Metadata:         item.Metadata,
		CreatedAt:        createdAt.UTC(),
		SourceKind:       strings.TrimSpace(item.Source.Kind),
		SourceID:         strings.TrimSpace(item.Source.ID),
	}, nil
}
