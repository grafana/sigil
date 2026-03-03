package control

import (
	"context"
	"errors"
	"fmt"
	"path"
	"sort"
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
	store         controlStore
	templateStore evalpkg.TemplateStore
	discovery     JudgeDiscovery
	now           func() time.Time
}

type validationError struct {
	cause error
}

func (e validationError) Error() string {
	return e.cause.Error()
}

func (e validationError) Unwrap() error {
	return e.cause
}

func newValidationError(err error) error {
	if err == nil {
		return nil
	}
	var target validationError
	if errors.As(err, &target) {
		return err
	}
	return validationError{cause: err}
}

func isValidationError(err error) bool {
	var target validationError
	return errors.As(err, &target)
}

type ForkPredefinedEvaluatorRequest struct {
	EvaluatorID string              `json:"evaluator_id"`
	Version     string              `json:"version,omitempty"`
	Config      map[string]any      `json:"config,omitempty"`
	OutputKeys  []evalpkg.OutputKey `json:"output_keys,omitempty"`
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

func NewService(store controlStore, discovery JudgeDiscovery, opts ...ServiceOption) *Service {
	s := &Service{
		store:     store,
		discovery: discovery,
		now:       time.Now,
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// ServiceOption configures optional dependencies on Service.
type ServiceOption func(*Service)

// WithTemplateStore configures the Service to read predefined evaluators
// from the templates table instead of hardcoded Go templates.
func WithTemplateStore(ts evalpkg.TemplateStore) ServiceOption {
	return func(s *Service) {
		s.templateStore = ts
	}
}

func (s *Service) CreateEvaluator(ctx context.Context, tenantID string, evaluator evalpkg.EvaluatorDefinition) (evalpkg.EvaluatorDefinition, error) {
	if s.store == nil {
		return evalpkg.EvaluatorDefinition{}, errors.New("eval store is required")
	}
	evaluator.TenantID = strings.TrimSpace(tenantID)
	if err := validateEvaluator(&evaluator); err != nil {
		return evalpkg.EvaluatorDefinition{}, newValidationError(err)
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
	return s.store.ListEvaluators(ctx, trimmedTenantID, limit, cursor)
}

func (s *Service) ListPredefinedEvaluators(ctx context.Context) []evalpkg.EvaluatorDefinition {
	if s.templateStore != nil {
		// Fall through to hardcoded templates on store error or empty result,
		// so predefined evaluators are always available.
		if items, err := s.listPredefinedFromTemplates(ctx); err == nil && len(items) > 0 {
			return items
		}
	}
	return s.listPredefinedFromHardcoded()
}

func (s *Service) listPredefinedFromHardcoded() []evalpkg.EvaluatorDefinition {
	templates := predefined.Templates()
	out := make([]evalpkg.EvaluatorDefinition, 0, len(templates))
	for _, template := range templates {
		item := template.EvaluatorDefinition
		item.IsPredefined = true
		item.TenantID = ""
		item.DeletedAt = nil
		out = append(out, item)
	}
	return out
}

func (s *Service) listPredefinedFromTemplates(ctx context.Context) ([]evalpkg.EvaluatorDefinition, error) {
	globalScope := evalpkg.TemplateScopeGlobal
	templates, _, err := s.templateStore.ListTemplates(ctx, GlobalTenantID, &globalScope, 500, 0)
	if err != nil {
		return nil, err
	}
	out := make([]evalpkg.EvaluatorDefinition, 0, len(templates))
	for _, tmpl := range templates {
		ver, err := s.templateStore.GetLatestTemplateVersion(ctx, tmpl.TenantID, tmpl.TemplateID)
		if err != nil || ver == nil {
			continue
		}
		out = append(out, evalpkg.EvaluatorDefinition{
			EvaluatorID:  tmpl.TemplateID,
			Version:      ver.Version,
			Kind:         tmpl.Kind,
			Config:       ver.Config,
			OutputKeys:   ver.OutputKeys,
			IsPredefined: true,
		})
	}
	return out, nil
}

func (s *Service) ForkPredefinedEvaluator(ctx context.Context, tenantID, templateID string, request ForkPredefinedEvaluatorRequest) (evalpkg.EvaluatorDefinition, error) {
	if s.store == nil {
		return evalpkg.EvaluatorDefinition{}, errors.New("eval store is required")
	}

	if s.templateStore != nil {
		if result, err := s.forkFromTemplateStore(ctx, tenantID, templateID, request); err == nil {
			return result, nil
		} else if !isTemplateFallbackError(err) {
			return evalpkg.EvaluatorDefinition{}, err
		}
		// Fall through to hardcoded templates on lookup failure.
	}
	return s.forkFromHardcoded(ctx, tenantID, templateID, request)
}

// templateFallbackError signals that the template store lookup failed and we
// should fall back to the hardcoded predefined templates.
type templateFallbackError struct{ cause error }

func (e templateFallbackError) Error() string { return e.cause.Error() }
func (e templateFallbackError) Unwrap() error { return e.cause }

func isTemplateFallbackError(err error) bool {
	var target templateFallbackError
	return errors.As(err, &target)
}

func (s *Service) forkFromTemplateStore(ctx context.Context, tenantID, templateID string, request ForkPredefinedEvaluatorRequest) (evalpkg.EvaluatorDefinition, error) {
	trimmedTemplateID := strings.TrimSpace(templateID)
	tmpl, err := s.templateStore.GetGlobalTemplate(ctx, trimmedTemplateID)
	if err != nil {
		return evalpkg.EvaluatorDefinition{}, err
	}
	if tmpl == nil {
		return evalpkg.EvaluatorDefinition{}, templateFallbackError{
			cause: fmt.Errorf("global template %q not found in store", trimmedTemplateID),
		}
	}

	ver, err := s.templateStore.GetLatestTemplateVersion(ctx, tmpl.TenantID, tmpl.TemplateID)
	if err != nil {
		return evalpkg.EvaluatorDefinition{}, err
	}
	if ver == nil {
		return evalpkg.EvaluatorDefinition{}, templateFallbackError{
			cause: fmt.Errorf("no version for global template %q", trimmedTemplateID),
		}
	}

	evaluatorID := strings.TrimSpace(request.EvaluatorID)
	if evaluatorID == "" {
		return evalpkg.EvaluatorDefinition{}, newValidationError(errors.New("evaluator_id is required"))
	}
	version := strings.TrimSpace(request.Version)
	if version == "" {
		version = ver.Version
	}

	forkConfig := cloneMap(ver.Config)
	for key, value := range request.Config {
		forkConfig[key] = value
	}

	outputKeys := ver.OutputKeys
	if len(request.OutputKeys) > 0 {
		outputKeys = request.OutputKeys
	}

	fork := evalpkg.EvaluatorDefinition{
		TenantID:              strings.TrimSpace(tenantID),
		EvaluatorID:           evaluatorID,
		Version:               version,
		Kind:                  tmpl.Kind,
		Config:                forkConfig,
		OutputKeys:            outputKeys,
		IsPredefined:          false,
		SourceTemplateID:      tmpl.TemplateID,
		SourceTemplateVersion: ver.Version,
	}
	return s.CreateEvaluator(ctx, fork.TenantID, fork)
}

func (s *Service) forkFromHardcoded(ctx context.Context, tenantID, templateID string, request ForkPredefinedEvaluatorRequest) (evalpkg.EvaluatorDefinition, error) {
	template, ok := findPredefinedTemplate(templateID)
	if !ok {
		return evalpkg.EvaluatorDefinition{}, newValidationError(fmt.Errorf("predefined evaluator %q was not found", strings.TrimSpace(templateID)))
	}

	evaluatorID := strings.TrimSpace(request.EvaluatorID)
	if evaluatorID == "" {
		return evalpkg.EvaluatorDefinition{}, newValidationError(errors.New("evaluator_id is required"))
	}
	version := strings.TrimSpace(request.Version)
	if version == "" {
		version = template.Version
	}

	forkConfig := cloneMap(template.Config)
	for key, value := range request.Config {
		forkConfig[key] = value
	}

	outputKeys := template.OutputKeys
	if len(request.OutputKeys) > 0 {
		outputKeys = request.OutputKeys
	}

	fork := evalpkg.EvaluatorDefinition{
		TenantID:     strings.TrimSpace(tenantID),
		EvaluatorID:  evaluatorID,
		Version:      version,
		Kind:         template.Kind,
		Config:       forkConfig,
		OutputKeys:   outputKeys,
		IsPredefined: false,
	}
	return s.CreateEvaluator(ctx, fork.TenantID, fork)
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
	trimmedEvaluatorID := strings.TrimSpace(evaluatorID)

	referencingRules, err := s.findEnabledRulesReferencingEvaluator(ctx, trimmedTenantID, trimmedEvaluatorID)
	if err != nil {
		return err
	}
	if len(referencingRules) > 0 {
		return newValidationError(fmt.Errorf(
			"cannot delete evaluator %q: referenced by enabled rules %s",
			trimmedEvaluatorID,
			strings.Join(referencingRules, ", "),
		))
	}

	if err := s.store.DeleteEvaluator(ctx, trimmedTenantID, trimmedEvaluatorID); err != nil {
		return err
	}
	s.refreshActiveMetrics(ctx, trimmedTenantID)
	return nil
}

func (s *Service) findEnabledRulesReferencingEvaluator(ctx context.Context, tenantID, evaluatorID string) ([]string, error) {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(evaluatorID) == "" {
		return nil, nil
	}

	matches := make([]string, 0)
	cursor := uint64(0)
	for {
		rules, nextCursor, err := s.store.ListRules(ctx, tenantID, 500, cursor)
		if err != nil {
			return nil, err
		}
		for _, rule := range rules {
			if !rule.Enabled || rule.DeletedAt != nil {
				continue
			}
			for _, referencedEvaluatorID := range rule.EvaluatorIDs {
				if strings.TrimSpace(referencedEvaluatorID) == evaluatorID {
					matches = append(matches, rule.RuleID)
					break
				}
			}
		}
		if nextCursor == 0 {
			break
		}
		cursor = nextCursor
	}

	sort.Strings(matches)
	return matches, nil
}

func (s *Service) CreateRule(ctx context.Context, tenantID string, rule evalpkg.RuleDefinition) (evalpkg.RuleDefinition, error) {
	if s.store == nil {
		return evalpkg.RuleDefinition{}, errors.New("eval store is required")
	}
	rule.TenantID = strings.TrimSpace(tenantID)
	if err := validateRule(&rule); err != nil {
		return evalpkg.RuleDefinition{}, newValidationError(err)
	}

	if err := s.validateRuleEvaluatorReferences(ctx, rule.TenantID, rule.EvaluatorIDs); err != nil {
		return evalpkg.RuleDefinition{}, err
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
	if enabled {
		if err := s.validateRuleEvaluatorReferences(ctx, rule.TenantID, rule.EvaluatorIDs); err != nil {
			return nil, err
		}
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

func (s *Service) validateRuleEvaluatorReferences(ctx context.Context, tenantID string, evaluatorIDs []string) error {
	for _, evaluatorID := range evaluatorIDs {
		evaluator, err := s.store.GetEvaluator(ctx, tenantID, evaluatorID)
		if err != nil {
			return err
		}
		if evaluator == nil {
			return newValidationError(fmt.Errorf("evaluator %q was not found", evaluatorID))
		}
	}
	return nil
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
		return nil, newValidationError(errors.New("provider query param is required"))
	}
	return s.discovery.ListModels(ctx, strings.TrimSpace(providerID))
}

func validateEvaluator(evaluator *evalpkg.EvaluatorDefinition) error {
	if evaluator == nil {
		return errors.New("evaluator is required")
	}
	evaluator.TenantID = strings.TrimSpace(evaluator.TenantID)
	evaluator.EvaluatorID = strings.TrimSpace(evaluator.EvaluatorID)
	evaluator.Version = strings.TrimSpace(evaluator.Version)

	if evaluator.TenantID == "" {
		return errors.New("tenant id is required")
	}
	if evaluator.EvaluatorID == "" {
		return errors.New("evaluator_id is required")
	}
	if evaluator.Version == "" {
		return errors.New("version is required")
	}
	if err := validateKind(evaluator.Kind); err != nil {
		return err
	}
	if len(evaluator.OutputKeys) == 0 {
		return errors.New("output_keys must include at least one key")
	}
	if len(evaluator.OutputKeys) > 1 {
		return errors.New("output_keys must include exactly one key")
	}
	for idx := range evaluator.OutputKeys {
		key := &evaluator.OutputKeys[idx]
		key.Key = strings.TrimSpace(key.Key)
		key.Unit = strings.TrimSpace(key.Unit)
		if key.Key == "" {
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

func validateRule(rule *evalpkg.RuleDefinition) error {
	if rule == nil {
		return errors.New("rule is required")
	}
	rule.TenantID = strings.TrimSpace(rule.TenantID)
	rule.RuleID = strings.TrimSpace(rule.RuleID)

	if rule.TenantID == "" {
		return errors.New("tenant id is required")
	}
	if rule.RuleID == "" {
		return errors.New("rule_id is required")
	}
	if len(rule.EvaluatorIDs) == 0 {
		return errors.New("evaluator_ids must include at least one id")
	}
	normalizedEvaluatorIDs := make([]string, 0, len(rule.EvaluatorIDs))
	for _, evaluatorID := range rule.EvaluatorIDs {
		trimmedEvaluatorID := strings.TrimSpace(evaluatorID)
		if trimmedEvaluatorID == "" {
			return errors.New("evaluator_ids cannot include empty values")
		}
		normalizedEvaluatorIDs = append(normalizedEvaluatorIDs, trimmedEvaluatorID)
	}
	rule.EvaluatorIDs = normalizedEvaluatorIDs

	selector := strings.TrimSpace(string(rule.Selector))
	rule.Selector = evalpkg.Selector(selector)
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
	} else {
		normalizedMatch, err := validateRuleMatch(rule.Match)
		if err != nil {
			return err
		}
		rule.Match = normalizedMatch
	}
	return nil
}

func validateRuleMatch(match map[string]any) (map[string]any, error) {
	normalized := make(map[string]any, len(match))
	for key, raw := range match {
		normalizedKey, err := validateRuleMatchKey(key)
		if err != nil {
			return nil, err
		}
		values, err := normalizeRuleMatchInput(raw)
		if err != nil {
			return nil, fmt.Errorf("match[%q] %w", key, err)
		}
		if len(values) == 0 {
			return nil, fmt.Errorf("match[%q] must include at least one non-empty string", key)
		}
		if err := validateRuleMatchValues(normalizedKey, values); err != nil {
			return nil, fmt.Errorf("match[%q] %w", key, err)
		}
		if _, exists := normalized[normalizedKey]; exists {
			return nil, fmt.Errorf("duplicate match key %q after normalization", normalizedKey)
		}
		normalized[normalizedKey] = values
	}
	return normalized, nil
}

func validateRuleMatchKey(key string) (string, error) {
	trimmedKey := strings.TrimSpace(key)
	if trimmedKey == "" {
		return "", errors.New("match keys cannot be empty")
	}

	switch trimmedKey {
	case "agent_name", "agent_version", "operation_name", "model.provider", "model.name", "mode", "error.type", "error.category":
		return trimmedKey, nil
	}

	if strings.HasPrefix(trimmedKey, "tags.") {
		tagKey := strings.TrimSpace(strings.TrimPrefix(trimmedKey, "tags."))
		if tagKey == "" {
			return "", errors.New(`match key "tags." must include a tag name`)
		}
		return "tags." + tagKey, nil
	}

	return "", fmt.Errorf("unsupported match key %q", key)
}

func validateRuleMatchValues(key string, values []string) error {
	if !ruleMatchKeyUsesGlob(key) {
		return nil
	}
	for _, value := range values {
		if !strings.ContainsAny(value, "*?[") {
			continue
		}
		if _, err := path.Match(strings.ToLower(value), ""); err != nil {
			return fmt.Errorf("value %q has invalid glob pattern: %v", value, err)
		}
	}
	return nil
}

func ruleMatchKeyUsesGlob(key string) bool {
	switch key {
	case "agent_name", "agent_version", "operation_name", "model.provider", "model.name":
		return true
	default:
		return false
	}
}

func normalizeRuleMatchInput(raw any) ([]string, error) {
	switch typed := raw.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil, nil
		}
		return []string{trimmed}, nil
	case []string:
		out := make([]string, 0, len(typed))
		for idx, value := range typed {
			trimmed := strings.TrimSpace(value)
			if trimmed == "" {
				return nil, fmt.Errorf("array item %d must be a non-empty string", idx)
			}
			out = append(out, trimmed)
		}
		return out, nil
	case []any:
		out := make([]string, 0, len(typed))
		for idx, value := range typed {
			asString, ok := value.(string)
			if !ok {
				return nil, fmt.Errorf("array item %d must be a string", idx)
			}
			trimmed := strings.TrimSpace(asString)
			if trimmed == "" {
				return nil, fmt.Errorf("array item %d must be a non-empty string", idx)
			}
			out = append(out, trimmed)
		}
		return out, nil
	default:
		return nil, errors.New("must be a string or array of strings")
	}
}

func (s *Service) refreshActiveMetrics(ctx context.Context, tenantID string) {
	if s.store == nil || strings.TrimSpace(tenantID) == "" {
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

func findPredefinedTemplate(templateID string) (evalpkg.EvaluatorDefinition, bool) {
	trimmedTemplateID := strings.TrimSpace(templateID)
	if trimmedTemplateID == "" {
		return evalpkg.EvaluatorDefinition{}, false
	}
	for _, template := range predefined.Templates() {
		if template.EvaluatorID == trimmedTemplateID {
			return template.EvaluatorDefinition, true
		}
	}
	return evalpkg.EvaluatorDefinition{}, false
}

func cloneMap(source map[string]any) map[string]any {
	if len(source) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(source))
	for key, value := range source {
		out[key] = value
	}
	return out
}
