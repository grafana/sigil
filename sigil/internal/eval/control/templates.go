package control

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
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
	templateID := strings.TrimSpace(req.TemplateID)
	if templateID == "" {
		return nil, newValidationError(errors.New("template_id is required"))
	}
	kind := evalpkg.EvaluatorKind(strings.TrimSpace(req.Kind))
	if err := validateKind(kind); err != nil {
		return nil, newValidationError(err)
	}
	version := strings.TrimSpace(req.Version)
	if version == "" {
		return nil, newValidationError(errors.New("version is required"))
	}
	if !isValidVersionFormat(version) {
		return nil, newValidationError(fmt.Errorf("version %q must be in YYYY-MM-DD or YYYY-MM-DD.N format", version))
	}
	if len(req.Config) == 0 {
		return nil, newValidationError(errors.New("config is required"))
	}
	if err := validateOutputKeys(req.OutputKeys); err != nil {
		return nil, newValidationError(err)
	}

	now := s.now().UTC()
	tmpl := evalpkg.TemplateDefinition{
		TenantID:      strings.TrimSpace(tenantID),
		TemplateID:    templateID,
		Scope:         evalpkg.TemplateScopeTenant,
		LatestVersion: version,
		Kind:          kind,
		Description:   strings.TrimSpace(req.Description),
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	ver := evalpkg.TemplateVersion{
		TenantID:   tmpl.TenantID,
		TemplateID: templateID,
		Version:    version,
		Config:     req.Config,
		OutputKeys: req.OutputKeys,
		Changelog:  strings.TrimSpace(req.Changelog),
		CreatedAt:  now,
	}

	if err := s.store.CreateTemplate(ctx, tmpl, ver); err != nil {
		return nil, err
	}
	return &tmpl, nil
}

// GetTemplate retrieves a template and its latest version. It checks tenant scope first,
// then falls back to global scope.
func (s *TemplateService) GetTemplate(ctx context.Context, tenantID, templateID string) (*evalpkg.TemplateDefinition, *evalpkg.TemplateVersion, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)

	tmpl, err := s.store.GetTemplate(ctx, trimmedTenantID, trimmedTemplateID)
	if err != nil {
		return nil, nil, err
	}
	if tmpl == nil {
		tmpl, err = s.store.GetGlobalTemplate(ctx, trimmedTemplateID)
		if err != nil {
			return nil, nil, err
		}
	}
	if tmpl == nil {
		return nil, nil, nil
	}

	ver, err := s.store.GetLatestTemplateVersion(ctx, tmpl.TenantID, trimmedTemplateID)
	if err != nil {
		return tmpl, nil, err
	}
	return tmpl, ver, nil
}

// ListTemplates returns templates visible to the tenant, optionally filtered by scope.
func (s *TemplateService) ListTemplates(ctx context.Context, tenantID string, scope *evalpkg.TemplateScope, limit int, cursor uint64) ([]evalpkg.TemplateDefinition, uint64, error) {
	return s.store.ListTemplates(ctx, strings.TrimSpace(tenantID), scope, limit, cursor)
}

// DeleteTemplate soft-deletes a tenant template. Global templates cannot be deleted.
func (s *TemplateService) DeleteTemplate(ctx context.Context, tenantID, templateID string) error {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)

	tmpl, err := s.store.GetTemplate(ctx, trimmedTenantID, trimmedTemplateID)
	if err != nil {
		return err
	}
	if tmpl == nil {
		// Check if it is a global template -- if so, forbid deletion.
		tmpl, err = s.store.GetGlobalTemplate(ctx, trimmedTemplateID)
		if err != nil {
			return err
		}
	}
	if tmpl != nil && tmpl.Scope == evalpkg.TemplateScopeGlobal {
		return newValidationError(errors.New("cannot delete global templates"))
	}
	return s.store.DeleteTemplate(ctx, trimmedTenantID, trimmedTemplateID)
}

// PublishVersion adds a new immutable version to an existing template.
func (s *TemplateService) PublishVersion(ctx context.Context, tenantID, templateID string, req PublishVersionRequest) (*evalpkg.TemplateVersion, error) {
	version := strings.TrimSpace(req.Version)
	if version == "" {
		return nil, newValidationError(errors.New("version is required"))
	}
	if !isValidVersionFormat(version) {
		return nil, newValidationError(fmt.Errorf("version %q must be in YYYY-MM-DD or YYYY-MM-DD.N format", version))
	}
	if len(req.Config) == 0 {
		return nil, newValidationError(errors.New("config is required"))
	}
	if err := validateOutputKeys(req.OutputKeys); err != nil {
		return nil, newValidationError(err)
	}

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)

	tmpl, err := s.store.GetTemplate(ctx, trimmedTenantID, trimmedTemplateID)
	if err != nil {
		return nil, err
	}
	if tmpl == nil {
		return nil, newValidationError(fmt.Errorf("template %q not found", trimmedTemplateID))
	}

	now := s.now().UTC()
	ver := evalpkg.TemplateVersion{
		TenantID:   trimmedTenantID,
		TemplateID: trimmedTemplateID,
		Version:    version,
		Config:     req.Config,
		OutputKeys: req.OutputKeys,
		Changelog:  strings.TrimSpace(req.Changelog),
		CreatedAt:  now,
	}

	if err := s.store.PublishTemplateVersion(ctx, ver); err != nil {
		return nil, err
	}
	return &ver, nil
}

// GetTemplateVersion retrieves a specific version. Tries tenant scope first, then global.
func (s *TemplateService) GetTemplateVersion(ctx context.Context, tenantID, templateID, version string) (*evalpkg.TemplateVersion, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)
	trimmedVersion := strings.TrimSpace(version)

	ver, err := s.store.GetTemplateVersion(ctx, trimmedTenantID, trimmedTemplateID, trimmedVersion)
	if err != nil {
		return nil, err
	}
	if ver != nil {
		return ver, nil
	}
	return s.store.GetTemplateVersion(ctx, GlobalTenantID, trimmedTemplateID, trimmedVersion)
}

// ListTemplateVersions returns all versions for a template. Tries tenant scope first, then global.
func (s *TemplateService) ListTemplateVersions(ctx context.Context, tenantID, templateID string) ([]evalpkg.TemplateVersion, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)

	versions, err := s.store.ListTemplateVersions(ctx, trimmedTenantID, trimmedTemplateID)
	if err != nil {
		return nil, err
	}
	if len(versions) > 0 {
		return versions, nil
	}
	return s.store.ListTemplateVersions(ctx, GlobalTenantID, trimmedTemplateID)
}

// ForkTemplate creates a concrete evaluator from a template version, applying optional config overrides.
func (s *TemplateService) ForkTemplate(ctx context.Context, tenantID, templateID string, req ForkTemplateRequest) (*evalpkg.EvaluatorDefinition, error) {
	if s.evalCreator == nil {
		return nil, errors.New("evaluator creator is required")
	}

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedTemplateID := strings.TrimSpace(templateID)

	evaluatorID := strings.TrimSpace(req.EvaluatorID)
	if evaluatorID == "" {
		return nil, newValidationError(errors.New("evaluator_id is required"))
	}

	// Resolve template (tenant first, then global).
	tmpl, _, err := s.GetTemplate(ctx, trimmedTenantID, trimmedTemplateID)
	if err != nil {
		return nil, err
	}
	if tmpl == nil {
		return nil, newValidationError(fmt.Errorf("template %q not found", trimmedTemplateID))
	}

	// Determine which version to use.
	versionStr := strings.TrimSpace(req.Version)
	if versionStr == "" {
		versionStr = tmpl.LatestVersion
	}

	// Fetch the version config.
	ver, err := s.store.GetTemplateVersion(ctx, tmpl.TenantID, trimmedTemplateID, versionStr)
	if err != nil {
		return nil, err
	}
	if ver == nil {
		ver, err = s.store.GetTemplateVersion(ctx, GlobalTenantID, trimmedTemplateID, versionStr)
		if err != nil {
			return nil, err
		}
	}
	if ver == nil {
		return nil, newValidationError(fmt.Errorf("template version %q not found for template %q", versionStr, trimmedTemplateID))
	}

	// Shallow-merge request config over template version config.
	forkConfig := cloneMap(ver.Config)
	for key, value := range req.Config {
		forkConfig[key] = value
	}

	// Use request output keys if provided, otherwise template version output keys.
	outputKeys := ver.OutputKeys
	if len(req.OutputKeys) > 0 {
		outputKeys = req.OutputKeys
	}

	fork := evalpkg.EvaluatorDefinition{
		TenantID:              trimmedTenantID,
		EvaluatorID:           evaluatorID,
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
	for _, key := range keys {
		if strings.TrimSpace(key.Key) == "" {
			return errors.New("output key name is required")
		}
		switch key.Type {
		case evalpkg.ScoreTypeNumber, evalpkg.ScoreTypeBool, evalpkg.ScoreTypeString:
		default:
			return fmt.Errorf("output key %q has invalid type", key.Key)
		}
	}
	return nil
}
