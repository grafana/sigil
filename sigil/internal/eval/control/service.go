package control

import (
	"context"
	"errors"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
	"github.com/grafana/sigil/sigil/internal/eval/predefined"
	"github.com/grafana/sigil/sigil/internal/eval/rules"
	"github.com/grafana/sigil/sigil/internal/eval/worker"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
)

// validIDPattern matches identifiers containing only word characters (\w) and dots.
var validIDPattern = regexp.MustCompile(`^[\w.]+$`)

func validateID(field, value string) error {
	if !validIDPattern.MatchString(value) {
		return fmt.Errorf("%s %q is invalid: only letters, digits, _, and . are allowed", field, value)
	}
	return nil
}

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
	store        controlStore
	discovery    JudgeDiscovery
	previewStore storage.RecentGenerationLister
	// previewWindowHrs is in hours and controls preview sampling window when previewStore is configured.
	previewWindowHrs int
	now              func() time.Time
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

// NewServiceWithPreview constructs a control service with optional preview support.
// When previewStore is nil or previewWindowHrs <= 0, PreviewRule returns an error.
func NewServiceWithPreview(store controlStore, discovery JudgeDiscovery, previewStore storage.RecentGenerationLister, previewWindowHrs int) *Service {
	return NewService(store, discovery, WithPreview(previewStore, previewWindowHrs))
}

// ServiceOption configures optional dependencies on Service.
type ServiceOption func(*Service)

// WithPreview configures preview data source and lookback window.
func WithPreview(previewStore storage.RecentGenerationLister, previewWindowHrs int) ServiceOption {
	return func(s *Service) {
		s.previewStore = previewStore
		s.previewWindowHrs = previewWindowHrs
	}
}

func (s *Service) CreateEvaluator(ctx context.Context, tenantID string, evaluator evalpkg.EvaluatorDefinition) (evalpkg.EvaluatorDefinition, error) {
	if s.store == nil {
		return evalpkg.EvaluatorDefinition{}, errors.New("eval store is required")
	}
	evaluator.TenantID = strings.TrimSpace(tenantID)
	if err := validateEvaluator(&evaluator); err != nil {
		return evalpkg.EvaluatorDefinition{}, ValidationWrap(err)
	}
	existing, err := s.store.GetEvaluatorVersion(ctx, evaluator.TenantID, evaluator.EvaluatorID, evaluator.Version)
	if err != nil {
		return evalpkg.EvaluatorDefinition{}, err
	}
	if existing != nil {
		return evalpkg.EvaluatorDefinition{}, ConflictError(fmt.Sprintf(
			"evaluator %q version %q already exists",
			evaluator.EvaluatorID,
			evaluator.Version,
		))
	}

	if err := s.store.CreateEvaluator(ctx, evaluator); err != nil {
		if errors.Is(err, evalpkg.ErrConflict) {
			return evalpkg.EvaluatorDefinition{}, ConflictError(fmt.Sprintf(
				"evaluator %q version %q already exists",
				evaluator.EvaluatorID,
				evaluator.Version,
			))
		}
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

func (s *Service) ForkPredefinedEvaluator(ctx context.Context, tenantID, templateID string, request ForkPredefinedEvaluatorRequest) (evalpkg.EvaluatorDefinition, error) {
	if s.store == nil {
		return evalpkg.EvaluatorDefinition{}, errors.New("eval store is required")
	}
	return s.forkFromHardcoded(ctx, tenantID, templateID, request)
}

func (s *Service) forkFromHardcoded(ctx context.Context, tenantID, templateID string, request ForkPredefinedEvaluatorRequest) (evalpkg.EvaluatorDefinition, error) {
	template, ok := findPredefinedTemplate(templateID)
	if !ok {
		return evalpkg.EvaluatorDefinition{}, NotFoundError(fmt.Sprintf("predefined evaluator %q was not found", strings.TrimSpace(templateID)))
	}
	normalizedRequest, err := request.normalizeAndValidate(template.Kind)
	if err != nil {
		return evalpkg.EvaluatorDefinition{}, err
	}

	evaluatorID := normalizedRequest.EvaluatorID
	version := normalizedRequest.Version
	if version == "" {
		version = template.Version
	}

	forkConfig := mergeEvaluatorForkConfig(template.Kind, template.Config, normalizedRequest.Config)

	outputKeys := template.OutputKeys
	if len(normalizedRequest.OutputKeys) > 0 {
		outputKeys = normalizedRequest.OutputKeys
	}
	if err := validateEvaluatorConfig(template.Kind, forkConfig, outputKeys); err != nil {
		return evalpkg.EvaluatorDefinition{}, ValidationWrap(err)
	}

	fork := evalpkg.EvaluatorDefinition{
		TenantID:              strings.TrimSpace(tenantID),
		EvaluatorID:           evaluatorID,
		Version:               version,
		Kind:                  template.Kind,
		Config:                forkConfig,
		OutputKeys:            outputKeys,
		IsPredefined:          false,
		SourceTemplateID:      template.EvaluatorID,
		SourceTemplateVersion: template.Version,
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
		return ValidationWrap(fmt.Errorf(
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
		return evalpkg.RuleDefinition{}, ValidationWrap(err)
	}
	existing, err := s.store.GetRule(ctx, rule.TenantID, rule.RuleID)
	if err != nil {
		return evalpkg.RuleDefinition{}, err
	}
	if existing != nil {
		return evalpkg.RuleDefinition{}, ConflictError(fmt.Sprintf("rule %q already exists", rule.RuleID))
	}

	if err := s.validateRuleEvaluatorReferences(ctx, rule.TenantID, rule.EvaluatorIDs); err != nil {
		return evalpkg.RuleDefinition{}, err
	}

	if err := s.store.CreateRule(ctx, rule); err != nil {
		if errors.Is(err, evalpkg.ErrConflict) {
			return evalpkg.RuleDefinition{}, ConflictError(fmt.Sprintf("rule %q already exists", rule.RuleID))
		}
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

func (s *Service) UpdateRule(ctx context.Context, tenantID, ruleID string, enabled *bool, selector *evalpkg.Selector, match map[string]any, sampleRate *float64, evaluatorIDs []string) (*evalpkg.RuleDefinition, error) {
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
	if enabled != nil {
		rule.Enabled = *enabled
	}
	if selector != nil {
		rule.Selector = *selector
	}
	if match != nil {
		rule.Match = match
	}
	if sampleRate != nil {
		rule.SampleRate = *sampleRate
	}
	if evaluatorIDs != nil {
		rule.EvaluatorIDs = evaluatorIDs
	}
	if err := validateRule(rule); err != nil {
		return nil, ValidationWrap(err)
	}
	if rule.Enabled {
		if err := s.validateRuleEvaluatorReferences(ctx, rule.TenantID, rule.EvaluatorIDs); err != nil {
			return nil, err
		}
	}
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
			return ValidationWrap(fmt.Errorf("evaluator %q was not found", evaluatorID))
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
		return nil, ValidationWrap(errors.New("provider query param is required"))
	}
	models, err := s.discovery.ListModels(ctx, strings.TrimSpace(providerID))
	if errors.Is(err, judges.ErrProviderNotFound) {
		return nil, NotFoundError(fmt.Sprintf("judge provider %q was not found", strings.TrimSpace(providerID)))
	}
	return models, err
}

const previewMaxSamples = 20
const inputPreviewMaxLen = 200

func (s *Service) PreviewRule(ctx context.Context, tenantID string, req evalpkg.RulePreviewRequest) (evalpkg.RulePreviewResponse, error) {
	if s.previewStore == nil || s.previewWindowHrs <= 0 {
		return evalpkg.RulePreviewResponse{}, ValidationWrap(errors.New("rule preview is not configured"))
	}
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return evalpkg.RulePreviewResponse{}, ValidationWrap(errors.New("tenant id is required"))
	}

	selector := strings.TrimSpace(string(req.Selector))
	if selector == "" {
		selector = string(evalpkg.SelectorUserVisibleTurn)
	}
	switch evalpkg.Selector(selector) {
	case evalpkg.SelectorUserVisibleTurn, evalpkg.SelectorAllAssistantGenerations, evalpkg.SelectorToolCallSteps, evalpkg.SelectorErroredGenerations:
	default:
		return evalpkg.RulePreviewResponse{}, ValidationWrap(errors.New("selector is invalid"))
	}
	if req.SampleRate < 0 || req.SampleRate > 1 {
		return evalpkg.RulePreviewResponse{}, ValidationWrap(errors.New("sample_rate must be between 0 and 1"))
	}
	match := req.Match
	if match == nil {
		match = map[string]any{}
	} else {
		normalizedMatch, err := validateRuleMatch(match)
		if err != nil {
			return evalpkg.RulePreviewResponse{}, ValidationWrap(err)
		}
		match = normalizedMatch
	}

	since := s.now().UTC().Add(-time.Duration(s.previewWindowHrs) * time.Hour)
	rows, err := s.previewStore.ListRecentGenerations(ctx, trimmedTenantID, since, 10000)
	if err != nil {
		return evalpkg.RulePreviewResponse{}, err
	}

	totalGenerations := len(rows)
	matchingCount := 0
	sampled := make([]evalpkg.PreviewGenerationSample, 0)
	ruleIDForSampling := strings.TrimSpace(req.RuleID)
	if ruleIDForSampling == "" {
		ruleIDForSampling = "preview"
	}

	for _, row := range rows {
		genRow := rules.GenerationRow{
			GenerationID:   row.GenerationID,
			ConversationID: row.ConversationID,
			Payload:        row.Payload,
		}
		generation, err := rules.DecodeGeneration(genRow)
		if err != nil {
			continue
		}
		if !rules.MatchesSelector(evalpkg.Selector(selector), generation) {
			continue
		}
		if !rules.MatchesRule(match, generation) {
			continue
		}
		matchingCount++
		conversationID := generation.GetConversationId()
		if conversationID == "" {
			conversationID = generation.GetId()
		}
		if !rules.ShouldSampleConversation(trimmedTenantID, conversationID, ruleIDForSampling, req.SampleRate) {
			continue
		}

		modelStr := ""
		if m := generation.GetModel(); m != nil {
			provider := strings.TrimSpace(m.GetProvider())
			name := strings.TrimSpace(m.GetName())
			if provider != "" && name != "" {
				modelStr = provider + "/" + name
			} else if name != "" {
				modelStr = name
			} else if provider != "" {
				modelStr = provider
			}
		}
		createdAt := ""
		if t := generation.GetStartedAt(); t != nil {
			createdAt = t.AsTime().UTC().Format(time.RFC3339)
		} else if t := generation.GetCompletedAt(); t != nil {
			createdAt = t.AsTime().UTC().Format(time.RFC3339)
		}
		if createdAt == "" && !row.CreatedAt.IsZero() {
			createdAt = row.CreatedAt.Format(time.RFC3339)
		}

		sampled = append(sampled, evalpkg.PreviewGenerationSample{
			GenerationID:   generation.GetId(),
			ConversationID: conversationID,
			AgentName:      strings.TrimSpace(generation.GetAgentName()),
			Model:          modelStr,
			CreatedAt:      createdAt,
			InputPreview:   inputPreviewFromGeneration(generation),
		})
	}

	samples := sampled
	if len(samples) > previewMaxSamples {
		samples = sampled[:previewMaxSamples]
	}

	return evalpkg.RulePreviewResponse{
		WindowHours:         s.previewWindowHrs,
		TotalGenerations:    totalGenerations,
		MatchingGenerations: matchingCount,
		SampledGenerations:  len(sampled),
		Samples:             samples,
	}, nil
}

func inputPreviewFromGeneration(generation *sigilv1.Generation) string {
	if generation == nil {
		return ""
	}
	var b strings.Builder
	runeCount := 0
	for _, msg := range generation.GetInput() {
		if msg == nil {
			continue
		}
		for _, part := range msg.GetParts() {
			if part == nil {
				continue
			}
			t := strings.TrimSpace(part.GetText())
			if t != "" {
				if b.Len() > 0 {
					b.WriteString("\n")
					runeCount++
				}
				b.WriteString(t)
				runeCount += utf8.RuneCountInString(t)
				if runeCount >= inputPreviewMaxLen {
					return truncateWithEllipsis(b.String(), inputPreviewMaxLen)
				}
			}
		}
	}
	return truncateWithEllipsis(b.String(), inputPreviewMaxLen)
}

func truncateWithEllipsis(s string, maxLen int) string {
	if utf8.RuneCountInString(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return string([]rune(s)[:maxLen])
	}
	return string([]rune(s)[:maxLen-3]) + "..."
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
	if err := validateID("evaluator_id", evaluator.EvaluatorID); err != nil {
		return err
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
		if err := validateOutputKeyConstraints(*key); err != nil {
			return err
		}
	}
	if evaluator.Config == nil {
		evaluator.Config = map[string]any{}
	}
	if err := validateEvaluatorConfig(evaluator.Kind, evaluator.Config, evaluator.OutputKeys); err != nil {
		return err
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
	if err := validateID("rule_id", rule.RuleID); err != nil {
		return err
	}
	if len(rule.EvaluatorIDs) == 0 {
		return errors.New("evaluator_ids must include at least one id")
	}
	normalizedEvaluatorIDs := make([]string, 0, len(rule.EvaluatorIDs))
	seenEvaluatorIDs := make(map[string]struct{}, len(rule.EvaluatorIDs))
	for _, evaluatorID := range rule.EvaluatorIDs {
		trimmedEvaluatorID := strings.TrimSpace(evaluatorID)
		if trimmedEvaluatorID == "" {
			return errors.New("evaluator_ids cannot include empty values")
		}
		if _, exists := seenEvaluatorIDs[trimmedEvaluatorID]; exists {
			return fmt.Errorf("evaluator_ids cannot include duplicate value %q", trimmedEvaluatorID)
		}
		seenEvaluatorIDs[trimmedEvaluatorID] = struct{}{}
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
