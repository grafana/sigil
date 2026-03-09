package control

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/predefined"
)

// evaluatorCreator abstracts evaluator creation with validation and metrics refresh.
// *Service satisfies this interface.
type evaluatorCreator interface {
	CreateEvaluator(ctx context.Context, tenantID string, evaluator evalpkg.EvaluatorDefinition) (evalpkg.EvaluatorDefinition, error)
}

// TemplateService coordinates template CRUD, versioning, forking, and validation.
type TemplateService struct {
	store       evalpkg.TemplateStore
	evalCreator evaluatorCreator
	now         func() time.Time
}

// NewTemplateService creates a TemplateService with the given stores.
// The evalCreator should be a *Service to ensure evaluators created via fork
// go through full validation and metrics refresh.
func NewTemplateService(store evalpkg.TemplateStore, evalCreator evaluatorCreator) *TemplateService {
	return &TemplateService{store: store, evalCreator: evalCreator, now: time.Now}
}

func predefinedTemplateDefinition(template predefined.Template) evalpkg.TemplateDefinition {
	return evalpkg.TemplateDefinition{
		TemplateID:    template.EvaluatorID,
		Scope:         evalpkg.TemplateScopeGlobal,
		LatestVersion: template.Version,
		Kind:          template.Kind,
		Description:   template.Description,
	}
}

func predefinedTemplateVersion(template predefined.Template) evalpkg.TemplateVersion {
	return evalpkg.TemplateVersion{
		TemplateID: template.EvaluatorID,
		Version:    template.Version,
		Config:     cloneMap(template.Config),
		OutputKeys: append([]evalpkg.OutputKey(nil), template.OutputKeys...),
	}
}

func findPredefinedTemplateDefinition(templateID string) (evalpkg.TemplateDefinition, evalpkg.TemplateVersion, bool) {
	trimmedTemplateID := strings.TrimSpace(templateID)
	if trimmedTemplateID == "" {
		return evalpkg.TemplateDefinition{}, evalpkg.TemplateVersion{}, false
	}
	for _, template := range predefined.Templates() {
		if template.EvaluatorID == trimmedTemplateID {
			return predefinedTemplateDefinition(template), predefinedTemplateVersion(template), true
		}
	}
	return evalpkg.TemplateDefinition{}, evalpkg.TemplateVersion{}, false
}

func paginateTemplateDefinitions(items []evalpkg.TemplateDefinition, limit int, cursor uint64) ([]evalpkg.TemplateDefinition, uint64) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].Scope != items[j].Scope {
			return items[i].Scope == evalpkg.TemplateScopeGlobal
		}
		return items[i].TemplateID < items[j].TemplateID
	})

	start := int(cursor)
	if start >= len(items) {
		return []evalpkg.TemplateDefinition{}, 0
	}

	end := start + limit
	if end > len(items) {
		end = len(items)
	}
	nextCursor := uint64(0)
	if end < len(items) {
		nextCursor = uint64(end)
	}
	return append([]evalpkg.TemplateDefinition(nil), items[start:end]...), nextCursor
}

// CreateTemplateRequest is the input for creating a new template with its initial version.
type CreateTemplateRequest struct {
	TemplateID  string              `json:"template_id"`
	Kind        string              `json:"kind"`
	Description string              `json:"description,omitempty"`
	Version     string              `json:"version"`
	Config      map[string]any      `json:"config"`
	OutputKeys  []evalpkg.OutputKey `json:"output_keys"`
	Changelog   string              `json:"changelog,omitempty"`
}

// PublishVersionRequest is the input for publishing a new version of an existing template.
type PublishVersionRequest struct {
	Version    string              `json:"version"`
	Config     map[string]any      `json:"config"`
	OutputKeys []evalpkg.OutputKey `json:"output_keys"`
	Changelog  string              `json:"changelog,omitempty"`
}

// ForkTemplateRequest is the input for forking a template into a concrete evaluator.
type ForkTemplateRequest struct {
	EvaluatorID string              `json:"evaluator_id"`
	Version     string              `json:"version,omitempty"`
	Config      map[string]any      `json:"config,omitempty"`
	OutputKeys  []evalpkg.OutputKey `json:"output_keys,omitempty"`
}

// CreateTemplate validates and persists a new template with its initial version.
// Users can only create tenant-scoped templates.
func (s *TemplateService) CreateTemplate(ctx context.Context, tenantID string, req CreateTemplateRequest) (*evalpkg.TemplateDefinition, error) {
	normalizedReq, err := req.normalizeAndValidate()
	if err != nil {
		return nil, err
	}
	templateID := normalizedReq.TemplateID
	kind := evalpkg.EvaluatorKind(normalizedReq.Kind)
	version := normalizedReq.Version

	now := s.now().UTC()
	tmpl := evalpkg.TemplateDefinition{
		TenantID:      strings.TrimSpace(tenantID),
		TemplateID:    templateID,
		Scope:         evalpkg.TemplateScopeTenant,
		LatestVersion: version,
		Kind:          kind,
		Description:   normalizedReq.Description,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	ver := evalpkg.TemplateVersion{
		TenantID:   tmpl.TenantID,
		TemplateID: templateID,
		Version:    version,
		Config:     normalizedReq.Config,
		OutputKeys: normalizedReq.OutputKeys,
		Changelog:  normalizedReq.Changelog,
		CreatedAt:  now,
	}

	existing, err := s.store.GetTemplate(ctx, tmpl.TenantID, templateID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ConflictError(fmt.Sprintf("template %q already exists", templateID))
	}

	if err := s.store.CreateTemplate(ctx, tmpl, ver); err != nil {
		if errors.Is(err, evalpkg.ErrConflict) {
			return nil, ConflictError(fmt.Sprintf("template %q already exists", templateID))
		}
		return nil, err
	}
	return &tmpl, nil
}

// GetTemplate retrieves a template and its latest version. Tenant templates are
// stored in the DB; predefined templates are synthesized from the built-in registry.
func (s *TemplateService) GetTemplate(ctx context.Context, tenantID, templateID string) (*evalpkg.TemplateDefinition, *evalpkg.TemplateVersion, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)

	tmpl, err := s.store.GetTemplate(ctx, trimmedTenantID, trimmedTemplateID)
	if err != nil {
		return nil, nil, err
	}
	if tmpl == nil {
		predefTmpl, predefVer, ok := findPredefinedTemplateDefinition(trimmedTemplateID)
		if !ok {
			return nil, nil, nil
		}
		return &predefTmpl, &predefVer, nil
	}

	ver, err := s.store.GetLatestTemplateVersion(ctx, tmpl.TenantID, trimmedTemplateID)
	if err != nil {
		return tmpl, nil, err
	}
	return tmpl, ver, nil
}

// ListTemplates returns tenant-managed templates plus synthesized predefined
// global templates when the scope filter allows them.
func (s *TemplateService) ListTemplates(ctx context.Context, tenantID string, scope *evalpkg.TemplateScope, limit int, cursor uint64) ([]evalpkg.TemplateDefinition, uint64, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	tenantItems, _, err := s.store.ListTemplates(ctx, trimmedTenantID, scope, 10000, 0)
	if err != nil {
		return nil, 0, err
	}

	items := append([]evalpkg.TemplateDefinition(nil), tenantItems...)
	if scope == nil || *scope == evalpkg.TemplateScopeGlobal {
		for _, template := range predefined.Templates() {
			items = append(items, predefinedTemplateDefinition(template))
		}
	}

	paged, nextCursor := paginateTemplateDefinitions(items, limit, cursor)
	return paged, nextCursor, nil
}

// DeleteTemplate soft-deletes a tenant template. Predefined global templates cannot be deleted.
func (s *TemplateService) DeleteTemplate(ctx context.Context, tenantID, templateID string) error {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)

	if _, _, ok := findPredefinedTemplateDefinition(trimmedTemplateID); ok {
		return ValidationWrap(errors.New("cannot delete global templates"))
	}
	return s.store.DeleteTemplate(ctx, trimmedTenantID, trimmedTemplateID)
}

// PublishVersion adds a new immutable version to an existing template.
func (s *TemplateService) PublishVersion(ctx context.Context, tenantID, templateID string, req PublishVersionRequest) (*evalpkg.TemplateVersion, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)

	tmpl, err := s.store.GetTemplate(ctx, trimmedTenantID, trimmedTemplateID)
	if err != nil {
		return nil, err
	}
	if tmpl == nil {
		if _, _, ok := findPredefinedTemplateDefinition(trimmedTemplateID); ok {
			return nil, ValidationWrap(errors.New("cannot publish versions for global templates"))
		}
		return nil, NotFoundError(fmt.Sprintf("template %q not found", trimmedTemplateID))
	}
	normalizedReq, err := req.normalizeAndValidate(tmpl.Kind)
	if err != nil {
		return nil, err
	}
	version := normalizedReq.Version

	existingVer, err := s.store.GetTemplateVersion(ctx, trimmedTenantID, trimmedTemplateID, version)
	if err != nil {
		return nil, err
	}
	if existingVer != nil {
		return nil, ConflictError(fmt.Sprintf("version %q already exists for template %q", version, trimmedTemplateID))
	}

	now := s.now().UTC()
	ver := evalpkg.TemplateVersion{
		TenantID:   trimmedTenantID,
		TemplateID: trimmedTemplateID,
		Version:    version,
		Config:     normalizedReq.Config,
		OutputKeys: normalizedReq.OutputKeys,
		Changelog:  normalizedReq.Changelog,
		CreatedAt:  now,
	}

	if err := s.store.PublishTemplateVersion(ctx, ver); err != nil {
		return nil, err
	}
	return &ver, nil
}

// GetTemplateVersion retrieves a specific version for a template. Predefined
// global templates intentionally expose no version history entries.
func (s *TemplateService) GetTemplateVersion(ctx context.Context, tenantID, templateID, version string) (*evalpkg.TemplateVersion, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)
	trimmedVersion := strings.TrimSpace(version)

	if _, _, ok := findPredefinedTemplateDefinition(trimmedTemplateID); ok {
		return nil, nil
	}
	return s.store.GetTemplateVersion(ctx, trimmedTenantID, trimmedTemplateID, trimmedVersion)
}

// ListTemplateVersions returns all versions for a template. Predefined global
// templates intentionally return no version history entries.
func (s *TemplateService) ListTemplateVersions(ctx context.Context, tenantID, templateID string) ([]evalpkg.TemplateVersion, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)

	if _, _, ok := findPredefinedTemplateDefinition(trimmedTemplateID); ok {
		return []evalpkg.TemplateVersion{}, nil
	}
	return s.store.ListTemplateVersions(ctx, trimmedTenantID, trimmedTemplateID)
}

// ForkTemplate creates a concrete evaluator from a template version, applying optional config overrides.
func (s *TemplateService) ForkTemplate(ctx context.Context, tenantID, templateID string, req ForkTemplateRequest) (*evalpkg.EvaluatorDefinition, error) {
	if s.evalCreator == nil {
		return nil, UnavailableError("evaluator creator is not configured", errors.New("evaluator creator is required"))
	}

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)

	// Resolve tenant or predefined template.
	tmpl, _, err := s.GetTemplate(ctx, trimmedTenantID, trimmedTemplateID)
	if err != nil {
		return nil, err
	}
	if tmpl == nil {
		return nil, NotFoundError(fmt.Sprintf("template %q not found", trimmedTemplateID))
	}
	normalizedReq, err := req.normalizeAndValidate(tmpl.Kind)
	if err != nil {
		return nil, err
	}

	// Determine which version to use.
	versionStr := normalizedReq.Version
	if versionStr == "" {
		versionStr = tmpl.LatestVersion
	}

	// Fetch the version config.
	var ver *evalpkg.TemplateVersion
	if tmpl.Scope == evalpkg.TemplateScopeGlobal {
		_, predefinedVersion, ok := findPredefinedTemplateDefinition(trimmedTemplateID)
		if !ok || versionStr != tmpl.LatestVersion {
			return nil, NotFoundError(fmt.Sprintf("template version %q not found for template %q", versionStr, trimmedTemplateID))
		}
		ver = &predefinedVersion
	} else {
		ver, err = s.store.GetTemplateVersion(ctx, tmpl.TenantID, trimmedTemplateID, versionStr)
		if err != nil {
			return nil, err
		}
		if ver == nil {
			return nil, NotFoundError(fmt.Sprintf("template version %q not found for template %q", versionStr, trimmedTemplateID))
		}
	}

	forkConfig := mergeEvaluatorForkConfig(tmpl.Kind, ver.Config, normalizedReq.Config)

	// Use request output keys if provided, otherwise template version output keys.
	outputKeys := ver.OutputKeys
	if len(normalizedReq.OutputKeys) > 0 {
		outputKeys = normalizedReq.OutputKeys
	}
	if err := validateEvaluatorConfig(tmpl.Kind, forkConfig, outputKeys); err != nil {
		return nil, ValidationWrap(err)
	}

	fork := evalpkg.EvaluatorDefinition{
		TenantID:              trimmedTenantID,
		EvaluatorID:           normalizedReq.EvaluatorID,
		Version:               versionStr,
		Kind:                  tmpl.Kind,
		Config:                forkConfig,
		OutputKeys:            outputKeys,
		IsPredefined:          false,
		SourceTemplateID:      trimmedTemplateID,
		SourceTemplateVersion: versionStr,
	}

	created, err := s.evalCreator.CreateEvaluator(ctx, trimmedTenantID, fork)
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// isValidVersionFormat checks YYYY-MM-DD or YYYY-MM-DD.N format.
func isValidVersionFormat(v string) bool {
	parts := strings.SplitN(v, ".", 2)
	_, err := time.Parse("2006-01-02", parts[0])
	if err != nil {
		return false
	}
	if len(parts) == 2 {
		if _, err := strconv.ParseUint(parts[1], 10, 64); err != nil {
			return false
		}
	}
	return true
}

func validateKind(kind evalpkg.EvaluatorKind) error {
	switch kind {
	case evalpkg.EvaluatorKindLLMJudge, evalpkg.EvaluatorKindJSONSchema, evalpkg.EvaluatorKindRegex, evalpkg.EvaluatorKindHeuristic:
		return nil
	default:
		return errors.New("kind is invalid")
	}
}

func validateOutputKeys(keys []evalpkg.OutputKey) error {
	if len(keys) != 1 {
		return errors.New("output_keys must include exactly one key")
	}
	for idx := range keys {
		key := &keys[idx]
		key.Key = strings.TrimSpace(key.Key)
		key.Unit = strings.TrimSpace(key.Unit)
		key.Description = strings.TrimSpace(key.Description)
		if key.Key == "" {
			return errors.New("output key name is required")
		}
		switch key.Type {
		case evalpkg.ScoreTypeNumber, evalpkg.ScoreTypeBool, evalpkg.ScoreTypeString:
		default:
			return fmt.Errorf("output key %q has invalid type", key.Key)
		}
		if len(key.Enum) > 0 {
			enumValues, err := normalizeOutputKeyStrings(key.Enum, fmt.Sprintf("output key %q enum", key.Key))
			if err != nil {
				return err
			}
			key.Enum = enumValues
		}
		if len(key.PassMatch) > 0 {
			passMatchValues, err := normalizeOutputKeyStrings(key.PassMatch, fmt.Sprintf("output key %q pass_match", key.Key))
			if err != nil {
				return err
			}
			key.PassMatch = passMatchValues
		}
		if err := validateOutputKeyConstraints(*key); err != nil {
			return err
		}
	}
	return nil
}

func validateOutputKeyConstraints(key evalpkg.OutputKey) error {
	if key.Min != nil || key.Max != nil {
		if key.Type != evalpkg.ScoreTypeNumber {
			return fmt.Errorf("output key %q: min/max are only valid for number types", key.Key)
		}
		if key.Min != nil && key.Max != nil && *key.Min >= *key.Max {
			return fmt.Errorf("output key %q: min (%g) must be < max (%g)", key.Key, *key.Min, *key.Max)
		}
	}
	if len(key.Enum) > 0 && key.Type != evalpkg.ScoreTypeString {
		return fmt.Errorf("output key %q: enum is only valid for string types", key.Key)
	}
	if key.PassThreshold != nil {
		if key.Type != evalpkg.ScoreTypeNumber {
			return fmt.Errorf("output key %q: pass_threshold is only valid for number types", key.Key)
		}
		if key.Min != nil && *key.PassThreshold < *key.Min {
			return fmt.Errorf("output key %q: pass_threshold (%g) must be >= min (%g)", key.Key, *key.PassThreshold, *key.Min)
		}
		if key.Max != nil && *key.PassThreshold > *key.Max {
			return fmt.Errorf("output key %q: pass_threshold (%g) must be <= max (%g)", key.Key, *key.PassThreshold, *key.Max)
		}
	}
	if len(key.PassMatch) > 0 && key.Type != evalpkg.ScoreTypeString {
		return fmt.Errorf("output key %q: pass_match is only valid for string types", key.Key)
	}
	if key.PassValue != nil && key.Type != evalpkg.ScoreTypeBool {
		return fmt.Errorf("output key %q: pass_value is only valid for bool types", key.Key)
	}
	if len(key.Enum) > 0 && len(key.PassMatch) > 0 {
		enumSet := make(map[string]struct{}, len(key.Enum))
		for _, value := range key.Enum {
			enumSet[value] = struct{}{}
		}
		for _, value := range key.PassMatch {
			if _, ok := enumSet[value]; !ok {
				return fmt.Errorf("output key %q: pass_match value %q must be included in enum", key.Key, value)
			}
		}
	}
	return nil
}
