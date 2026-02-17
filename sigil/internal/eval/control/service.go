package control

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/predefined"
	"github.com/grafana/sigil/sigil/internal/eval/worker"
)

type JudgeProvider struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type JudgeModel struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Provider      string `json:"provider"`
	ContextWindow int    `json:"context_window"`
}

type JudgeDiscovery interface {
	ListProviders(ctx context.Context) []JudgeProvider
	ListModels(ctx context.Context, providerID string) ([]JudgeModel, error)
}

type Service struct {
	store     controlStore
	seeder    *predefined.Seeder
	discovery JudgeDiscovery
	now       func() time.Time
}

type controlStore interface {
	CreateEvaluator(ctx context.Context, evaluator evalpkg.EvaluatorDefinition) error
	GetEvaluator(ctx context.Context, tenantID, evaluatorID string) (*evalpkg.EvaluatorDefinition, error)
	GetEvaluatorVersion(ctx context.Context, tenantID, evaluatorID, version string) (*evalpkg.EvaluatorDefinition, error)
	ListEvaluators(ctx context.Context, tenantID string, limit int, cursor uint64) ([]evalpkg.EvaluatorDefinition, uint64, error)
	DeleteEvaluator(ctx context.Context, tenantID, evaluatorID string) error
	CountActiveEvaluators(ctx context.Context, tenantID string) (int64, error)

	CreateRule(ctx context.Context, rule evalpkg.RuleDefinition) error
	GetRule(ctx context.Context, tenantID, ruleID string) (*evalpkg.RuleDefinition, error)
	ListRules(ctx context.Context, tenantID string, limit int, cursor uint64) ([]evalpkg.RuleDefinition, uint64, error)
	UpdateRule(ctx context.Context, rule evalpkg.RuleDefinition) error
	DeleteRule(ctx context.Context, tenantID, ruleID string) error
	CountActiveRules(ctx context.Context, tenantID string) (int64, error)
}

func NewService(store controlStore, seeder *predefined.Seeder, discovery JudgeDiscovery) *Service {
	return &Service{
		store:     store,
		seeder:    seeder,
		discovery: discovery,
		now:       time.Now,
	}
}

func (s *Service) CreateEvaluator(ctx context.Context, tenantID string, evaluator evalpkg.EvaluatorDefinition) (evalpkg.EvaluatorDefinition, error) {
	if s.store == nil {
		return evalpkg.EvaluatorDefinition{}, errors.New("eval store is required")
	}
	evaluator.TenantID = strings.TrimSpace(tenantID)
	if err := validateEvaluator(evaluator); err != nil {
		return evalpkg.EvaluatorDefinition{}, err
	}

	if err := s.store.CreateEvaluator(ctx, evaluator); err != nil {
		return evalpkg.EvaluatorDefinition{}, err
	}
	s.refreshActiveMetrics(ctx, evaluator.TenantID)

	item, err := s.store.GetEvaluatorVersion(ctx, evaluator.TenantID, evaluator.EvaluatorID, evaluator.Version)
	if err != nil {
		return evalpkg.EvaluatorDefinition{}, err
	}
	if item == nil {
		return evalpkg.EvaluatorDefinition{}, fmt.Errorf("created evaluator %q was not found", evaluator.EvaluatorID)
	}
	return *item, nil
}

func (s *Service) ListEvaluators(ctx context.Context, tenantID string, limit int, cursor uint64) ([]evalpkg.EvaluatorDefinition, uint64, error) {
	if s.store == nil {
		return nil, 0, errors.New("eval store is required")
	}
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return nil, 0, errors.New("tenant id is required")
	}
	if s.seeder != nil {
		if err := s.seeder.EnsureTenantSeeded(ctx, trimmedTenantID); err != nil {
			return nil, 0, err
		}
	}
	return s.store.ListEvaluators(ctx, trimmedTenantID, limit, cursor)
}

func (s *Service) GetEvaluator(ctx context.Context, tenantID, evaluatorID string) (*evalpkg.EvaluatorDefinition, error) {
	if s.store == nil {
		return nil, errors.New("eval store is required")
	}
	return s.store.GetEvaluator(ctx, strings.TrimSpace(tenantID), strings.TrimSpace(evaluatorID))
}

func (s *Service) DeleteEvaluator(ctx context.Context, tenantID, evaluatorID string) error {
	if s.store == nil {
		return errors.New("eval store is required")
	}
	trimmedTenantID := strings.TrimSpace(tenantID)
	if err := s.store.DeleteEvaluator(ctx, trimmedTenantID, strings.TrimSpace(evaluatorID)); err != nil {
		return err
	}
	s.refreshActiveMetrics(ctx, trimmedTenantID)
	return nil
}

func (s *Service) CreateRule(ctx context.Context, tenantID string, rule evalpkg.RuleDefinition) (evalpkg.RuleDefinition, error) {
	if s.store == nil {
		return evalpkg.RuleDefinition{}, errors.New("eval store is required")
	}
	rule.TenantID = strings.TrimSpace(tenantID)
	if err := validateRule(rule); err != nil {
		return evalpkg.RuleDefinition{}, err
	}

	for _, evaluatorID := range rule.EvaluatorIDs {
		evaluator, err := s.store.GetEvaluator(ctx, rule.TenantID, evaluatorID)
		if err != nil {
			return evalpkg.RuleDefinition{}, err
		}
		if evaluator == nil {
			return evalpkg.RuleDefinition{}, fmt.Errorf("evaluator %q was not found", evaluatorID)
		}
	}

	if err := s.store.CreateRule(ctx, rule); err != nil {
		return evalpkg.RuleDefinition{}, err
	}
	s.refreshActiveMetrics(ctx, rule.TenantID)
	created, err := s.store.GetRule(ctx, rule.TenantID, rule.RuleID)
	if err != nil {
		return evalpkg.RuleDefinition{}, err
	}
	if created == nil {
		return evalpkg.RuleDefinition{}, fmt.Errorf("created rule %q was not found", rule.RuleID)
	}
	return *created, nil
}

func (s *Service) ListRules(ctx context.Context, tenantID string, limit int, cursor uint64) ([]evalpkg.RuleDefinition, uint64, error) {
	if s.store == nil {
		return nil, 0, errors.New("eval store is required")
	}
	return s.store.ListRules(ctx, strings.TrimSpace(tenantID), limit, cursor)
}

func (s *Service) GetRule(ctx context.Context, tenantID, ruleID string) (*evalpkg.RuleDefinition, error) {
	if s.store == nil {
		return nil, errors.New("eval store is required")
	}
	return s.store.GetRule(ctx, strings.TrimSpace(tenantID), strings.TrimSpace(ruleID))
}

func (s *Service) UpdateRuleEnabled(ctx context.Context, tenantID, ruleID string, enabled bool) (*evalpkg.RuleDefinition, error) {
	if s.store == nil {
		return nil, errors.New("eval store is required")
	}
	rule, err := s.store.GetRule(ctx, strings.TrimSpace(tenantID), strings.TrimSpace(ruleID))
	if err != nil {
		return nil, err
	}
	if rule == nil {
		return nil, nil
	}
	rule.Enabled = enabled
	rule.UpdatedAt = s.now().UTC()
	if err := s.store.UpdateRule(ctx, *rule); err != nil {
		if errors.Is(err, evalpkg.ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	s.refreshActiveMetrics(ctx, rule.TenantID)
	updated, err := s.store.GetRule(ctx, rule.TenantID, rule.RuleID)
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *Service) DeleteRule(ctx context.Context, tenantID, ruleID string) error {
	if s.store == nil {
		return errors.New("eval store is required")
	}
	trimmedTenantID := strings.TrimSpace(tenantID)
	if err := s.store.DeleteRule(ctx, trimmedTenantID, strings.TrimSpace(ruleID)); err != nil {
		return err
	}
	s.refreshActiveMetrics(ctx, trimmedTenantID)
	return nil
}

func (s *Service) ListJudgeProviders(ctx context.Context) []JudgeProvider {
	if s.discovery == nil {
		return []JudgeProvider{}
	}
	return s.discovery.ListProviders(ctx)
}

func (s *Service) ListJudgeModels(ctx context.Context, providerID string) ([]JudgeModel, error) {
	if s.discovery == nil {
		return []JudgeModel{}, nil
	}
	if strings.TrimSpace(providerID) == "" {
		return nil, errors.New("provider query param is required")
	}
	return s.discovery.ListModels(ctx, strings.TrimSpace(providerID))
}

func validateEvaluator(evaluator evalpkg.EvaluatorDefinition) error {
	if strings.TrimSpace(evaluator.TenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(evaluator.EvaluatorID) == "" {
		return errors.New("evaluator_id is required")
	}
	if strings.TrimSpace(evaluator.Version) == "" {
		return errors.New("version is required")
	}
	switch evaluator.Kind {
	case evalpkg.EvaluatorKindLLMJudge, evalpkg.EvaluatorKindJSONSchema, evalpkg.EvaluatorKindRegex, evalpkg.EvaluatorKindHeuristic:
	default:
		return errors.New("kind is invalid")
	}
	if len(evaluator.OutputKeys) == 0 {
		return errors.New("output_keys must include at least one key")
	}
	for _, key := range evaluator.OutputKeys {
		if strings.TrimSpace(key.Key) == "" {
			return errors.New("output key name is required")
		}
		switch key.Type {
		case evalpkg.ScoreTypeNumber, evalpkg.ScoreTypeBool, evalpkg.ScoreTypeString:
		default:
			return fmt.Errorf("output key %q has invalid type", key.Key)
		}
	}
	if evaluator.Config == nil {
		evaluator.Config = map[string]any{}
	}
	return nil
}

func validateRule(rule evalpkg.RuleDefinition) error {
	if strings.TrimSpace(rule.TenantID) == "" {
		return errors.New("tenant id is required")
	}
	if strings.TrimSpace(rule.RuleID) == "" {
		return errors.New("rule_id is required")
	}
	if len(rule.EvaluatorIDs) == 0 {
		return errors.New("evaluator_ids must include at least one id")
	}
	for _, evaluatorID := range rule.EvaluatorIDs {
		if strings.TrimSpace(evaluatorID) == "" {
			return errors.New("evaluator_ids cannot include empty values")
		}
	}
	if rule.Selector == "" {
		rule.Selector = evalpkg.SelectorUserVisibleTurn
	}
	switch rule.Selector {
	case evalpkg.SelectorUserVisibleTurn, evalpkg.SelectorAllAssistantGenerations, evalpkg.SelectorToolCallSteps, evalpkg.SelectorErroredGenerations:
	default:
		return errors.New("selector is invalid")
	}
	if rule.SampleRate < 0 || rule.SampleRate > 1 {
		return errors.New("sample_rate must be between 0 and 1")
	}
	if rule.Match == nil {
		rule.Match = map[string]any{}
	}
	return nil
}

func (s *Service) refreshActiveMetrics(ctx context.Context, tenantID string) {
	if s == nil || s.store == nil || strings.TrimSpace(tenantID) == "" {
		return
	}
	activeEvaluators, err := s.store.CountActiveEvaluators(ctx, tenantID)
	if err == nil {
		worker.SetActiveEvaluators(tenantID, activeEvaluators)
	}
	activeRules, err := s.store.CountActiveRules(ctx, tenantID)
	if err == nil {
		worker.SetActiveRules(tenantID, activeRules)
	}
}
