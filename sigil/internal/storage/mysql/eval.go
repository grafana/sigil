package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var _ evalpkg.EvalStore = (*WALStore)(nil)

const defaultEvalWorkItemClaimTTL = 10 * time.Minute

func (s *WALStore) CreateEvaluator(ctx context.Context, evaluator evalpkg.EvaluatorDefinition) error {
	if strings.TrimSpace(evaluator.TenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(evaluator.EvaluatorID) == "" {
		return errors.New("evaluator id is required")
	}
	if strings.TrimSpace(evaluator.Version) == "" {
		return errors.New("evaluator version is required")
	}
	if strings.TrimSpace(string(evaluator.Kind)) == "" {
		return errors.New("evaluator kind is required")
	}

	configJSON, err := marshalJSONField(evaluator.Config)
	if err != nil {
		return fmt.Errorf("marshal evaluator config: %w", err)
	}
	outputKeysJSON, err := marshalJSONField(evaluator.OutputKeys)
	if err != nil {
		return fmt.Errorf("marshal evaluator output keys: %w", err)
	}

	now := time.Now().UTC()
	model := EvalEvaluatorModel{
		TenantID:       strings.TrimSpace(evaluator.TenantID),
		EvaluatorID:    strings.TrimSpace(evaluator.EvaluatorID),
		Version:        strings.TrimSpace(evaluator.Version),
		Kind:           string(evaluator.Kind),
		ConfigJSON:     configJSON,
		OutputKeysJSON: outputKeysJSON,
		IsPredefined:   evaluator.IsPredefined,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if evaluator.SourceTemplateID != "" {
		model.SourceTemplateID = &evaluator.SourceTemplateID
	}
	if evaluator.SourceTemplateVersion != "" {
		model.SourceTemplateVersion = &evaluator.SourceTemplateVersion
	}

	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "evaluator_id"}, {Name: "version"}},
		DoUpdates: clause.Assignments(map[string]any{
			"kind":                    model.Kind,
			"config_json":             model.ConfigJSON,
			"output_keys_json":        model.OutputKeysJSON,
			"is_predefined":           model.IsPredefined,
			"source_template_id":      model.SourceTemplateID,
			"source_template_version": model.SourceTemplateVersion,
			"deleted_at":              nil,
			"updated_at":              now,
		}),
	}).Create(&model).Error
}

func (s *WALStore) GetEvaluator(ctx context.Context, tenantID, evaluatorID string) (*evalpkg.EvaluatorDefinition, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(evaluatorID) == "" {
		return nil, errors.New("evaluator id is required")
	}

	var row EvalEvaluatorModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND evaluator_id = ? AND deleted_at IS NULL", tenantID, evaluatorID).
		Order("updated_at DESC, id DESC").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get evaluator: %w", err)
	}

	out, err := evaluatorModelToDefinition(row)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *WALStore) GetEvaluatorVersion(ctx context.Context, tenantID, evaluatorID, version string) (*evalpkg.EvaluatorDefinition, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(evaluatorID) == "" {
		return nil, errors.New("evaluator id is required")
	}
	if strings.TrimSpace(version) == "" {
		return nil, errors.New("evaluator version is required")
	}

	var row EvalEvaluatorModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND evaluator_id = ? AND version = ? AND deleted_at IS NULL", tenantID, evaluatorID, version).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get evaluator version: %w", err)
	}

	out, err := evaluatorModelToDefinition(row)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *WALStore) ListEvaluators(ctx context.Context, tenantID string, limit int, cursor uint64) ([]evalpkg.EvaluatorDefinition, uint64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, 0, errors.New("tenant id is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	query := s.db.WithContext(ctx).
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Order("id ASC").
		Limit(limit + 1)
	if cursor > 0 {
		query = query.Where("id > ?", cursor)
	}

	var rows []EvalEvaluatorModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list evaluators: %w", err)
	}

	nextCursor := uint64(0)
	if len(rows) > limit {
		nextCursor = rows[limit-1].ID
		rows = rows[:limit]
	}

	out := make([]evalpkg.EvaluatorDefinition, 0, len(rows))
	for _, row := range rows {
		item, err := evaluatorModelToDefinition(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, item)
	}
	return out, nextCursor, nil
}

func (s *WALStore) DeleteEvaluator(ctx context.Context, tenantID, evaluatorID string) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(evaluatorID) == "" {
		return errors.New("evaluator id is required")
	}

	now := time.Now().UTC()
	return s.db.WithContext(ctx).
		Model(&EvalEvaluatorModel{}).
		Where("tenant_id = ? AND evaluator_id = ? AND deleted_at IS NULL", tenantID, evaluatorID).
		Updates(map[string]any{"deleted_at": now, "updated_at": now}).
		Error
}

func (s *WALStore) CountActiveEvaluators(ctx context.Context, tenantID string) (int64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return 0, errors.New("tenant id is required")
	}
	var count int64
	err := s.db.WithContext(ctx).
		Model(&EvalEvaluatorModel{}).
		Distinct("evaluator_id").
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Count(&count).Error
	if err != nil {
		return 0, fmt.Errorf("count active evaluators: %w", err)
	}
	return count, nil
}

func (s *WALStore) CreateRule(ctx context.Context, rule evalpkg.RuleDefinition) error {
	if strings.TrimSpace(rule.TenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(rule.RuleID) == "" {
		return errors.New("rule id is required")
	}
	if len(rule.EvaluatorIDs) == 0 {
		return errors.New("at least one evaluator id is required")
	}

	matchJSON, err := marshalJSONField(rule.Match)
	if err != nil {
		return fmt.Errorf("marshal rule match: %w", err)
	}
	evaluatorIDsJSON, err := marshalJSONField(dedupeSortedStrings(rule.EvaluatorIDs))
	if err != nil {
		return fmt.Errorf("marshal rule evaluator ids: %w", err)
	}

	selector := string(rule.Selector)
	if strings.TrimSpace(selector) == "" {
		selector = string(evalpkg.SelectorUserVisibleTurn)
	}

	now := time.Now().UTC()
	model := EvalRuleModel{
		TenantID:         strings.TrimSpace(rule.TenantID),
		RuleID:           strings.TrimSpace(rule.RuleID),
		Enabled:          rule.Enabled,
		Selector:         selector,
		MatchJSON:        matchJSON,
		SampleRate:       clampSampleRate(rule.SampleRate),
		EvaluatorIDsJSON: evaluatorIDsJSON,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "rule_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"enabled":            model.Enabled,
			"selector":           model.Selector,
			"match_json":         model.MatchJSON,
			"sample_rate":        model.SampleRate,
			"evaluator_ids_json": model.EvaluatorIDsJSON,
			"deleted_at":         nil,
			"updated_at":         now,
		}),
	}).Create(&model).Error
}

func (s *WALStore) GetRule(ctx context.Context, tenantID, ruleID string) (*evalpkg.RuleDefinition, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(ruleID) == "" {
		return nil, errors.New("rule id is required")
	}

	var row EvalRuleModel
	err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND rule_id = ? AND deleted_at IS NULL", tenantID, ruleID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get rule: %w", err)
	}

	out, err := ruleModelToDefinition(row)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *WALStore) ListRules(ctx context.Context, tenantID string, limit int, cursor uint64) ([]evalpkg.RuleDefinition, uint64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, 0, errors.New("tenant id is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	query := s.db.WithContext(ctx).
		Where("tenant_id = ? AND deleted_at IS NULL", tenantID).
		Order("id ASC").
		Limit(limit + 1)
	if cursor > 0 {
		query = query.Where("id > ?", cursor)
	}

	var rows []EvalRuleModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list rules: %w", err)
	}

	nextCursor := uint64(0)
	if len(rows) > limit {
		nextCursor = rows[limit-1].ID
		rows = rows[:limit]
	}

	out := make([]evalpkg.RuleDefinition, 0, len(rows))
	for _, row := range rows {
		item, err := ruleModelToDefinition(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, item)
	}
	return out, nextCursor, nil
}

func (s *WALStore) ListEnabledRules(ctx context.Context, tenantID string) ([]evalpkg.RuleDefinition, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}

	var rows []EvalRuleModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND enabled = ? AND deleted_at IS NULL", tenantID, true).
		Order("updated_at DESC, id DESC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list enabled rules: %w", err)
	}

	out := make([]evalpkg.RuleDefinition, 0, len(rows))
	for _, row := range rows {
		item, err := ruleModelToDefinition(row)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *WALStore) UpdateRule(ctx context.Context, rule evalpkg.RuleDefinition) error {
	if strings.TrimSpace(rule.TenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(rule.RuleID) == "" {
		return errors.New("rule id is required")
	}
	if len(rule.EvaluatorIDs) == 0 {
		return errors.New("at least one evaluator id is required")
	}

	matchJSON, err := marshalJSONField(rule.Match)
	if err != nil {
		return fmt.Errorf("marshal rule match: %w", err)
	}
	evaluatorIDsJSON, err := marshalJSONField(dedupeSortedStrings(rule.EvaluatorIDs))
	if err != nil {
		return fmt.Errorf("marshal rule evaluator ids: %w", err)
	}

	now := time.Now().UTC()
	selector := string(rule.Selector)
	if strings.TrimSpace(selector) == "" {
		selector = string(evalpkg.SelectorUserVisibleTurn)
	}

	result := s.db.WithContext(ctx).
		Model(&EvalRuleModel{}).
		Where("tenant_id = ? AND rule_id = ? AND deleted_at IS NULL", rule.TenantID, rule.RuleID).
		Updates(map[string]any{
			"enabled":            rule.Enabled,
			"selector":           selector,
			"match_json":         matchJSON,
			"sample_rate":        clampSampleRate(rule.SampleRate),
			"evaluator_ids_json": evaluatorIDsJSON,
			"updated_at":         now,
		})
	if result.Error != nil {
		return fmt.Errorf("update rule: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return evalpkg.ErrNotFound
	}
	return nil
}

func (s *WALStore) DeleteRule(ctx context.Context, tenantID, ruleID string) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(ruleID) == "" {
		return errors.New("rule id is required")
	}

	now := time.Now().UTC()
	return s.db.WithContext(ctx).
		Model(&EvalRuleModel{}).
		Where("tenant_id = ? AND rule_id = ? AND deleted_at IS NULL", tenantID, ruleID).
		Updates(map[string]any{"deleted_at": now, "updated_at": now}).
		Error
}

func (s *WALStore) CountActiveRules(ctx context.Context, tenantID string) (int64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return 0, errors.New("tenant id is required")
	}
	var count int64
	err := s.db.WithContext(ctx).
		Model(&EvalRuleModel{}).
		Where("tenant_id = ? AND enabled = ? AND deleted_at IS NULL", tenantID, true).
		Count(&count).Error
	if err != nil {
		return 0, fmt.Errorf("count active rules: %w", err)
	}
	return count, nil
}

func (s *WALStore) InsertScore(ctx context.Context, score evalpkg.GenerationScore) (bool, error) {
	model, err := scoreToModel(score)
	if err != nil {
		return false, err
	}

	err = s.db.WithContext(ctx).Create(&model).Error
	if err != nil {
		if isDuplicateKeyError(err) {
			return false, nil
		}
		return false, fmt.Errorf("insert score: %w", err)
	}
	return true, nil
}

func (s *WALStore) InsertScoreBatch(ctx context.Context, scores []evalpkg.GenerationScore) (int, error) {
	if len(scores) == 0 {
		return 0, nil
	}

	inserted := 0
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, score := range scores {
			model, err := scoreToModel(score)
			if err != nil {
				return err
			}
			result := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "tenant_id"}, {Name: "score_id"}},
				DoNothing: true,
			}).Create(&model)
			if result.Error != nil {
				return fmt.Errorf("insert score batch item: %w", result.Error)
			}
			if result.RowsAffected > 0 {
				inserted++
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return inserted, nil
}

func (s *WALStore) GetScoresByGeneration(ctx context.Context, tenantID, generationID string, limit int, cursor uint64) ([]evalpkg.GenerationScore, uint64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, 0, errors.New("tenant id is required")
	}
	if strings.TrimSpace(generationID) == "" {
		return nil, 0, errors.New("generation id is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	query := s.db.WithContext(ctx).
		Where("tenant_id = ? AND generation_id = ?", tenantID, generationID).
		Order("id ASC").
		Limit(limit + 1)
	if cursor > 0 {
		query = query.Where("id > ?", cursor)
	}

	var rows []GenerationScoreModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("get scores by generation: %w", err)
	}

	nextCursor := uint64(0)
	if len(rows) > limit {
		nextCursor = rows[limit-1].ID
		rows = rows[:limit]
	}

	out := make([]evalpkg.GenerationScore, 0, len(rows))
	for _, row := range rows {
		score, err := scoreModelToDomain(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, score)
	}
	return out, nextCursor, nil
}

func (s *WALStore) GetScoresByRule(ctx context.Context, tenantID, ruleID string, limit int, cursor uint64) ([]evalpkg.GenerationScore, uint64, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, 0, errors.New("tenant id is required")
	}
	if strings.TrimSpace(ruleID) == "" {
		return nil, 0, errors.New("rule id is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	query := s.db.WithContext(ctx).
		Where("tenant_id = ? AND rule_id = ?", tenantID, ruleID).
		Order("id ASC").
		Limit(limit + 1)
	if cursor > 0 {
		query = query.Where("id > ?", cursor)
	}

	var rows []GenerationScoreModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("get scores by rule: %w", err)
	}

	nextCursor := uint64(0)
	if len(rows) > limit {
		nextCursor = rows[limit-1].ID
		rows = rows[:limit]
	}

	out := make([]evalpkg.GenerationScore, 0, len(rows))
	for _, row := range rows {
		score, err := scoreModelToDomain(row)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, score)
	}
	return out, nextCursor, nil
}

func (s *WALStore) GetLatestScoresByGeneration(ctx context.Context, tenantID, generationID string) (map[string]evalpkg.LatestScore, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(generationID) == "" {
		return nil, errors.New("generation id is required")
	}

	var rows []GenerationScoreModel
	if err := s.db.WithContext(ctx).
		Where("tenant_id = ? AND generation_id = ?", tenantID, generationID).
		Order("created_at DESC, id DESC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("get latest scores by generation: %w", err)
	}

	out := make(map[string]evalpkg.LatestScore)
	for _, row := range rows {
		if _, ok := out[row.ScoreKey]; ok {
			continue
		}
		score, err := scoreModelToDomain(row)
		if err != nil {
			return nil, err
		}
		out[row.ScoreKey] = evalpkg.LatestScore{
			ScoreKey:         score.ScoreKey,
			ScoreType:        score.ScoreType,
			Value:            score.Value,
			Passed:           score.Passed,
			EvaluatorID:      score.EvaluatorID,
			EvaluatorVersion: score.EvaluatorVersion,
			CreatedAt:        score.CreatedAt,
		}
	}
	return out, nil
}

func (s *WALStore) GetLatestScoresByConversation(ctx context.Context, tenantID, conversationID string) (map[string]map[string]evalpkg.LatestScore, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(conversationID) == "" {
		return nil, errors.New("conversation id is required")
	}

	// Deduplicate to the latest score per (generation_id, score_key) in a
	// single pass using a CTE with ROW_NUMBER().
	var rows []GenerationScoreModel
	if err := s.db.WithContext(ctx).Raw(
		"WITH ranked AS ( "+
			"SELECT *, ROW_NUMBER() OVER (PARTITION BY generation_id, score_key ORDER BY created_at DESC, id DESC) AS rn "+
			"FROM generation_scores "+
			"WHERE tenant_id = ? AND conversation_id = ? "+
			") SELECT * FROM ranked WHERE rn = 1",
		tenantID, conversationID,
	).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("get latest scores by conversation: %w", err)
	}

	out := make(map[string]map[string]evalpkg.LatestScore)
	for _, row := range rows {
		genScores, ok := out[row.GenerationID]
		if !ok {
			genScores = make(map[string]evalpkg.LatestScore)
			out[row.GenerationID] = genScores
		}
		score, err := scoreModelToDomain(row)
		if err != nil {
			return nil, err
		}
		genScores[row.ScoreKey] = evalpkg.LatestScore{
			ScoreKey:         score.ScoreKey,
			ScoreType:        score.ScoreType,
			Value:            score.Value,
			Passed:           score.Passed,
			EvaluatorID:      score.EvaluatorID,
			EvaluatorVersion: score.EvaluatorVersion,
			CreatedAt:        score.CreatedAt,
		}
	}
	return out, nil
}

func (s *WALStore) ListConversationEvalSummaries(ctx context.Context, tenantID string, conversationIDs []string) (map[string]evalpkg.ConversationEvalSummary, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	normalizedIDs := normalizeConversationIDs(conversationIDs)
	if len(normalizedIDs) == 0 {
		return map[string]evalpkg.ConversationEvalSummary{}, nil
	}

	type summaryRow struct {
		ConversationID string
		TotalScores    int
		PassCount      int
		FailCount      int
	}

	// Deduplicate to the latest score per (generation_id, score_key) before
	// aggregating. Without this, re-evaluations inflate counts and can show
	// both a pass and a fail for the same evaluation — inconsistent with the
	// latest_scores returned by GetLatestScoresByConversation.
	var rows []summaryRow
	if err := s.db.WithContext(ctx).Raw(
		"SELECT conversation_id, "+
			"COUNT(*) AS total_scores, "+
			"SUM(CASE WHEN passed = true THEN 1 ELSE 0 END) AS pass_count, "+
			"SUM(CASE WHEN passed = false THEN 1 ELSE 0 END) AS fail_count "+
			"FROM ( "+
			"  SELECT conversation_id, passed, "+
			"    ROW_NUMBER() OVER (PARTITION BY conversation_id, generation_id, score_key ORDER BY created_at DESC, id DESC) AS rn "+
			"  FROM generation_scores "+
			"  WHERE tenant_id = ? AND conversation_id IN ? "+
			") AS latest "+
			"WHERE rn = 1 "+
			"GROUP BY conversation_id",
		tenantID, normalizedIDs,
	).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list conversation eval summaries: %w", err)
	}

	out := make(map[string]evalpkg.ConversationEvalSummary, len(rows))
	for _, row := range rows {
		out[row.ConversationID] = evalpkg.ConversationEvalSummary{
			TotalScores: row.TotalScores,
			PassCount:   row.PassCount,
			FailCount:   row.FailCount,
		}
	}
	return out, nil
}

func (s *WALStore) EnqueueWorkItem(ctx context.Context, item evalpkg.WorkItem) error {
	if strings.TrimSpace(item.TenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(item.WorkID) == "" {
		return errors.New("work id is required")
	}
	if strings.TrimSpace(item.GenerationID) == "" {
		return errors.New("generation id is required")
	}
	if strings.TrimSpace(item.EvaluatorID) == "" {
		return errors.New("evaluator id is required")
	}
	if strings.TrimSpace(item.EvaluatorVersion) == "" {
		return errors.New("evaluator version is required")
	}
	if strings.TrimSpace(item.RuleID) == "" {
		return errors.New("rule id is required")
	}

	now := time.Now().UTC()
	if item.ScheduledAt.IsZero() {
		item.ScheduledAt = now
	}
	status := item.Status
	if strings.TrimSpace(string(status)) == "" {
		status = evalpkg.WorkItemStatusQueued
	}

	model := EvalWorkItemModel{
		TenantID:         strings.TrimSpace(item.TenantID),
		WorkID:           strings.TrimSpace(item.WorkID),
		GenerationID:     strings.TrimSpace(item.GenerationID),
		EvaluatorID:      strings.TrimSpace(item.EvaluatorID),
		EvaluatorVersion: strings.TrimSpace(item.EvaluatorVersion),
		RuleID:           strings.TrimSpace(item.RuleID),
		ScheduledAt:      item.ScheduledAt.UTC(),
		Attempts:         item.Attempts,
		Status:           string(status),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if strings.TrimSpace(item.LastError) != "" {
		lastError := strings.TrimSpace(item.LastError)
		model.LastError = &lastError
	}

	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "tenant_id"}, {Name: "work_id"}},
		DoNothing: true,
	}).Create(&model).Error
}

func (s *WALStore) ClaimWorkItems(ctx context.Context, now time.Time, limit int) ([]evalpkg.WorkItem, error) {
	if limit <= 0 {
		return []evalpkg.WorkItem{}, nil
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	now = now.UTC()
	staleBefore := now.Add(-defaultEvalWorkItemClaimTTL)

	claimed := make([]EvalWorkItemModel, 0, limit)
	err := runWithRetryableLockError(ctx, func() error {
		return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&EvalWorkItemModel{}).
				Where("status = ? AND claimed_at IS NOT NULL AND claimed_at < ?", string(evalpkg.WorkItemStatusClaimed), staleBefore).
				Updates(map[string]any{
					"status":     string(evalpkg.WorkItemStatusQueued),
					"claimed_at": nil,
					"updated_at": now,
				}).Error; err != nil {
				return err
			}

			var ids []uint64
			if err := tx.Model(&EvalWorkItemModel{}).
				Select("id").
				Where("status = ? AND scheduled_at <= ?", string(evalpkg.WorkItemStatusQueued), now).
				Order("scheduled_at ASC, id ASC").
				Limit(limit).
				Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
				Scan(&ids).Error; err != nil {
				return err
			}
			if len(ids) == 0 {
				claimed = claimed[:0]
				return nil
			}

			if err := tx.Model(&EvalWorkItemModel{}).
				Where("id IN ?", ids).
				Updates(map[string]any{
					"status":     string(evalpkg.WorkItemStatusClaimed),
					"claimed_at": now,
					"updated_at": now,
				}).Error; err != nil {
				return err
			}

			if err := tx.Where("id IN ?", ids).
				Order("scheduled_at ASC, id ASC").
				Find(&claimed).Error; err != nil {
				return err
			}
			return nil
		})
	})
	if err != nil {
		return nil, fmt.Errorf("claim work items: %w", err)
	}

	out := make([]evalpkg.WorkItem, 0, len(claimed))
	for _, row := range claimed {
		out = append(out, workItemModelToDomain(row))
	}
	return out, nil
}

func (s *WALStore) CompleteWorkItem(ctx context.Context, tenantID, workID string) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(workID) == "" {
		return errors.New("work id is required")
	}

	now := time.Now().UTC()
	result := s.db.WithContext(ctx).
		Model(&EvalWorkItemModel{}).
		Where("tenant_id = ? AND work_id = ? AND status IN ?", tenantID, workID, []string{string(evalpkg.WorkItemStatusQueued), string(evalpkg.WorkItemStatusClaimed)}).
		Updates(map[string]any{
			"status":     string(evalpkg.WorkItemStatusSuccess),
			"claimed_at": nil,
			"updated_at": now,
		})
	if result.Error != nil {
		return fmt.Errorf("complete work item: %w", result.Error)
	}
	if result.RowsAffected > 0 {
		return nil
	}

	var existing EvalWorkItemModel
	err := s.db.WithContext(ctx).
		Select("status").
		Where("tenant_id = ? AND work_id = ?", tenantID, workID).
		First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return evalpkg.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("complete work item: %w", err)
	}
	return nil
}

func (s *WALStore) RequeueClaimedWorkItem(ctx context.Context, tenantID, workID string) error {
	if strings.TrimSpace(tenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(workID) == "" {
		return errors.New("work id is required")
	}

	now := time.Now().UTC()
	result := s.db.WithContext(ctx).
		Model(&EvalWorkItemModel{}).
		Where("tenant_id = ? AND work_id = ? AND status = ?", tenantID, workID, string(evalpkg.WorkItemStatusClaimed)).
		Updates(map[string]any{
			"status":     string(evalpkg.WorkItemStatusQueued),
			"claimed_at": nil,
			"updated_at": now,
		})
	if result.Error != nil {
		return fmt.Errorf("requeue claimed work item: %w", result.Error)
	}
	if result.RowsAffected > 0 {
		return nil
	}

	var existing EvalWorkItemModel
	err := s.db.WithContext(ctx).
		Select("status").
		Where("tenant_id = ? AND work_id = ?", tenantID, workID).
		First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return evalpkg.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("requeue claimed work item: %w", err)
	}
	return nil
}

func (s *WALStore) FailWorkItem(ctx context.Context, tenantID, workID, lastError string, retryAt time.Time, maxAttempts int, permanent bool) (bool, error) {
	if strings.TrimSpace(tenantID) == "" {
		return false, errors.New("tenant id is required")
	}
	if strings.TrimSpace(workID) == "" {
		return false, errors.New("work id is required")
	}
	if maxAttempts <= 0 {
		maxAttempts = 1
	}
	if retryAt.IsZero() {
		retryAt = time.Now().UTC()
	}

	requeue := false
	err := runWithRetryableLockError(ctx, func() error {
		return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var row EvalWorkItemModel
			err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("tenant_id = ? AND work_id = ?", tenantID, workID).
				First(&row).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return evalpkg.ErrNotFound
			}
			if err != nil {
				return err
			}
			if row.Status != string(evalpkg.WorkItemStatusClaimed) {
				return nil
			}

			attempts := row.Attempts + 1
			now := time.Now().UTC()
			trimmedErr := strings.TrimSpace(lastError)
			if trimmedErr == "" {
				trimmedErr = "unknown work item error"
			}
			updates := map[string]any{
				"attempts":   attempts,
				"last_error": trimmedErr,
				"claimed_at": nil,
				"updated_at": now,
			}

			requeue = !permanent && attempts < maxAttempts
			if requeue {
				updates["status"] = string(evalpkg.WorkItemStatusQueued)
				updates["scheduled_at"] = retryAt.UTC()
			} else {
				updates["status"] = string(evalpkg.WorkItemStatusFailed)
			}

			return tx.Model(&EvalWorkItemModel{}).
				Where("id = ?", row.ID).
				Updates(updates).Error
		})
	})
	if err != nil {
		return false, fmt.Errorf("fail work item: %w", err)
	}
	return requeue, nil
}

func (s *WALStore) CountWorkItemsByStatus(ctx context.Context, status evalpkg.WorkItemStatus) (map[string]int64, error) {
	if strings.TrimSpace(string(status)) == "" {
		return nil, errors.New("status is required")
	}

	type row struct {
		TenantID string
		Count    int64
	}

	rows := make([]row, 0)
	err := s.db.WithContext(ctx).
		Model(&EvalWorkItemModel{}).
		Select("tenant_id, COUNT(*) AS count").
		Where("status = ?", string(status)).
		Group("tenant_id").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("count work items by status: %w", err)
	}

	out := make(map[string]int64, len(rows))
	for _, item := range rows {
		out[item.TenantID] = item.Count
	}
	return out, nil
}

func evaluatorModelToDefinition(row EvalEvaluatorModel) (evalpkg.EvaluatorDefinition, error) {
	config := map[string]any{}
	if err := unmarshalJSONField(row.ConfigJSON, &config); err != nil {
		return evalpkg.EvaluatorDefinition{}, fmt.Errorf("decode evaluator config: %w", err)
	}
	outputKeys := make([]evalpkg.OutputKey, 0)
	if err := unmarshalJSONField(row.OutputKeysJSON, &outputKeys); err != nil {
		return evalpkg.EvaluatorDefinition{}, fmt.Errorf("decode evaluator output keys: %w", err)
	}
	def := evalpkg.EvaluatorDefinition{
		TenantID:     row.TenantID,
		EvaluatorID:  row.EvaluatorID,
		Version:      row.Version,
		Kind:         evalpkg.EvaluatorKind(row.Kind),
		Config:       config,
		OutputKeys:   outputKeys,
		IsPredefined: row.IsPredefined,
		DeletedAt:    row.DeletedAt,
		CreatedAt:    row.CreatedAt.UTC(),
		UpdatedAt:    row.UpdatedAt.UTC(),
	}
	if row.SourceTemplateID != nil {
		def.SourceTemplateID = *row.SourceTemplateID
	}
	if row.SourceTemplateVersion != nil {
		def.SourceTemplateVersion = *row.SourceTemplateVersion
	}
	return def, nil
}

func ruleModelToDefinition(row EvalRuleModel) (evalpkg.RuleDefinition, error) {
	match := map[string]any{}
	if err := unmarshalJSONField(row.MatchJSON, &match); err != nil {
		return evalpkg.RuleDefinition{}, fmt.Errorf("decode rule match: %w", err)
	}
	evaluatorIDs := make([]string, 0)
	if err := unmarshalJSONField(row.EvaluatorIDsJSON, &evaluatorIDs); err != nil {
		return evalpkg.RuleDefinition{}, fmt.Errorf("decode rule evaluator ids: %w", err)
	}
	return evalpkg.RuleDefinition{
		TenantID:     row.TenantID,
		RuleID:       row.RuleID,
		Enabled:      row.Enabled,
		Selector:     evalpkg.Selector(row.Selector),
		Match:        match,
		SampleRate:   clampSampleRate(row.SampleRate),
		EvaluatorIDs: evaluatorIDs,
		DeletedAt:    row.DeletedAt,
		CreatedAt:    row.CreatedAt.UTC(),
		UpdatedAt:    row.UpdatedAt.UTC(),
	}, nil
}

func scoreToModel(score evalpkg.GenerationScore) (GenerationScoreModel, error) {
	if strings.TrimSpace(score.TenantID) == "" {
		return GenerationScoreModel{}, errors.New("tenant id is required")
	}
	if strings.TrimSpace(score.ScoreID) == "" {
		return GenerationScoreModel{}, errors.New("score id is required")
	}
	if strings.TrimSpace(score.GenerationID) == "" {
		return GenerationScoreModel{}, errors.New("generation id is required")
	}
	if strings.TrimSpace(score.EvaluatorID) == "" {
		return GenerationScoreModel{}, errors.New("evaluator id is required")
	}
	if strings.TrimSpace(score.EvaluatorVersion) == "" {
		return GenerationScoreModel{}, errors.New("evaluator version is required")
	}
	if strings.TrimSpace(score.ScoreKey) == "" {
		return GenerationScoreModel{}, errors.New("score key is required")
	}
	if strings.TrimSpace(string(score.ScoreType)) == "" {
		score.ScoreType = score.Value.Type()
	}
	if strings.TrimSpace(string(score.ScoreType)) == "" {
		return GenerationScoreModel{}, errors.New("score type is required")
	}

	metadataJSON, err := marshalJSONField(score.Metadata)
	if err != nil {
		return GenerationScoreModel{}, fmt.Errorf("marshal score metadata: %w", err)
	}

	createdAt := score.CreatedAt.UTC()
	if score.CreatedAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	ingestedAt := score.IngestedAt.UTC()
	if score.IngestedAt.IsZero() {
		ingestedAt = time.Now().UTC()
	}

	model := GenerationScoreModel{
		TenantID:         strings.TrimSpace(score.TenantID),
		ScoreID:          strings.TrimSpace(score.ScoreID),
		GenerationID:     strings.TrimSpace(score.GenerationID),
		EvaluatorID:      strings.TrimSpace(score.EvaluatorID),
		EvaluatorVersion: strings.TrimSpace(score.EvaluatorVersion),
		ScoreKey:         strings.TrimSpace(score.ScoreKey),
		ScoreType:        string(score.ScoreType),
		CreatedAt:        createdAt,
		IngestedAt:       ingestedAt,
		MetadataJSON:     metadataJSON,
	}
	if value := strings.TrimSpace(score.ConversationID); value != "" {
		model.ConversationID = &value
	}
	if value := strings.TrimSpace(score.TraceID); value != "" {
		model.TraceID = &value
	}
	if value := strings.TrimSpace(score.SpanID); value != "" {
		model.SpanID = &value
	}
	if value := strings.TrimSpace(score.RuleID); value != "" {
		model.RuleID = &value
	}
	if value := strings.TrimSpace(score.RunID); value != "" {
		model.RunID = &value
	}
	if value := strings.TrimSpace(score.Unit); value != "" {
		model.Unit = &value
	}
	if value := strings.TrimSpace(score.Explanation); value != "" {
		model.Explanation = &value
	}
	if value := strings.TrimSpace(score.SourceKind); value != "" {
		model.SourceKind = &value
	}
	if value := strings.TrimSpace(score.SourceID); value != "" {
		model.SourceID = &value
	}
	if score.Passed != nil {
		model.Passed = score.Passed
	}

	switch score.ScoreType {
	case evalpkg.ScoreTypeNumber:
		model.ScoreNumber = score.Value.Number
	case evalpkg.ScoreTypeBool:
		model.ScoreBool = score.Value.Bool
	case evalpkg.ScoreTypeString:
		model.ScoreString = score.Value.String
	default:
		return GenerationScoreModel{}, fmt.Errorf("unsupported score type %q", score.ScoreType)
	}

	return model, nil
}

func scoreModelToDomain(row GenerationScoreModel) (evalpkg.GenerationScore, error) {
	metadata := map[string]any{}
	if err := unmarshalJSONField(row.MetadataJSON, &metadata); err != nil {
		return evalpkg.GenerationScore{}, fmt.Errorf("decode score metadata: %w", err)
	}

	value := evalpkg.ScoreValue{}
	scoreType := evalpkg.ScoreType(row.ScoreType)
	switch scoreType {
	case evalpkg.ScoreTypeNumber:
		value.Number = row.ScoreNumber
	case evalpkg.ScoreTypeBool:
		value.Bool = row.ScoreBool
	case evalpkg.ScoreTypeString:
		value.String = row.ScoreString
	}

	score := evalpkg.GenerationScore{
		TenantID:         row.TenantID,
		ScoreID:          row.ScoreID,
		GenerationID:     row.GenerationID,
		EvaluatorID:      row.EvaluatorID,
		EvaluatorVersion: row.EvaluatorVersion,
		ScoreKey:         row.ScoreKey,
		ScoreType:        scoreType,
		Value:            value,
		Passed:           row.Passed,
		Metadata:         metadata,
		CreatedAt:        row.CreatedAt.UTC(),
		IngestedAt:       row.IngestedAt.UTC(),
	}
	if row.ConversationID != nil {
		score.ConversationID = *row.ConversationID
	}
	if row.TraceID != nil {
		score.TraceID = *row.TraceID
	}
	if row.SpanID != nil {
		score.SpanID = *row.SpanID
	}
	if row.RuleID != nil {
		score.RuleID = *row.RuleID
	}
	if row.RunID != nil {
		score.RunID = *row.RunID
	}
	if row.Unit != nil {
		score.Unit = *row.Unit
	}
	if row.Explanation != nil {
		score.Explanation = *row.Explanation
	}
	if row.SourceKind != nil {
		score.SourceKind = *row.SourceKind
	}
	if row.SourceID != nil {
		score.SourceID = *row.SourceID
	}

	return score, nil
}

func workItemModelToDomain(row EvalWorkItemModel) evalpkg.WorkItem {
	item := evalpkg.WorkItem{
		TenantID:         row.TenantID,
		WorkID:           row.WorkID,
		GenerationID:     row.GenerationID,
		EvaluatorID:      row.EvaluatorID,
		EvaluatorVersion: row.EvaluatorVersion,
		RuleID:           row.RuleID,
		ScheduledAt:      row.ScheduledAt.UTC(),
		Attempts:         row.Attempts,
		Status:           evalpkg.WorkItemStatus(row.Status),
		CreatedAt:        row.CreatedAt.UTC(),
		UpdatedAt:        row.UpdatedAt.UTC(),
	}
	if row.LastError != nil {
		item.LastError = *row.LastError
	}
	return item
}

func marshalJSONField(value any) (string, error) {
	if value == nil {
		return "{}", nil
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	if len(payload) == 0 {
		return "{}", nil
	}
	return string(payload), nil
}

func unmarshalJSONField(raw string, out any) error {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		trimmed = "{}"
	}
	return json.Unmarshal([]byte(trimmed), out)
}

func dedupeSortedStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		set[trimmed] = struct{}{}
	}
	out := make([]string, 0, len(set))
	for value := range set {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func clampSampleRate(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}
