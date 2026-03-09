package control

import (
	"fmt"
	"strings"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

type createEvaluatorRequest struct {
	EvaluatorID string              `json:"evaluator_id"`
	Version     string              `json:"version"`
	Kind        string              `json:"kind"`
	Description string              `json:"description,omitempty"`
	Config      map[string]any      `json:"config"`
	OutputKeys  []evalpkg.OutputKey `json:"output_keys"`
}

func (r createEvaluatorRequest) toEvaluatorDefinition(tenantID string) (evalpkg.EvaluatorDefinition, error) {
	evaluatorID := strings.TrimSpace(r.EvaluatorID)
	if evaluatorID == "" {
		return evalpkg.EvaluatorDefinition{}, ValidationError("evaluator_id is required")
	}
	if err := validateID("evaluator_id", evaluatorID); err != nil {
		return evalpkg.EvaluatorDefinition{}, ValidationWrap(err)
	}
	version := strings.TrimSpace(r.Version)
	if version == "" {
		return evalpkg.EvaluatorDefinition{}, ValidationError("version is required")
	}
	kind := evalpkg.EvaluatorKind(strings.TrimSpace(r.Kind))
	if err := validateKind(kind); err != nil {
		return evalpkg.EvaluatorDefinition{}, ValidationWrap(err)
	}
	if err := validateOutputKeys(r.OutputKeys); err != nil {
		return evalpkg.EvaluatorDefinition{}, ValidationWrap(err)
	}
	if r.Config == nil {
		return evalpkg.EvaluatorDefinition{}, ValidationError("config is required")
	}
	config := cloneMap(r.Config)
	if err := validateEvaluatorConfig(kind, config, r.OutputKeys); err != nil {
		return evalpkg.EvaluatorDefinition{}, ValidationWrap(err)
	}
	return evalpkg.EvaluatorDefinition{
		TenantID:    strings.TrimSpace(tenantID),
		EvaluatorID: evaluatorID,
		Version:     version,
		Kind:        kind,
		Description: strings.TrimSpace(r.Description),
		Config:      config,
		OutputKeys:  r.OutputKeys,
	}, nil
}

func (r ForkPredefinedEvaluatorRequest) normalizeAndValidate(kind evalpkg.EvaluatorKind) (ForkPredefinedEvaluatorRequest, error) {
	evaluatorID := strings.TrimSpace(r.EvaluatorID)
	if evaluatorID == "" {
		return ForkPredefinedEvaluatorRequest{}, ValidationError("evaluator_id is required")
	}
	if err := validateID("evaluator_id", evaluatorID); err != nil {
		return ForkPredefinedEvaluatorRequest{}, ValidationWrap(err)
	}
	version := strings.TrimSpace(r.Version)
	config := cloneMap(r.Config)
	if len(config) > 0 {
		if err := validateEvaluatorConfigOverrides(kind, config); err != nil {
			return ForkPredefinedEvaluatorRequest{}, ValidationWrap(err)
		}
	}
	outputKeys := append([]evalpkg.OutputKey(nil), r.OutputKeys...)
	if len(outputKeys) > 0 {
		if err := validateOutputKeys(outputKeys); err != nil {
			return ForkPredefinedEvaluatorRequest{}, ValidationWrap(err)
		}
	}
	return ForkPredefinedEvaluatorRequest{
		EvaluatorID: evaluatorID,
		Version:     version,
		Config:      config,
		OutputKeys:  outputKeys,
	}, nil
}

func (r CreateTemplateRequest) normalizeAndValidate() (CreateTemplateRequest, error) {
	req := r
	req.TemplateID = strings.TrimSpace(req.TemplateID)
	req.Version = strings.TrimSpace(req.Version)
	req.Kind = strings.TrimSpace(req.Kind)
	req.Description = strings.TrimSpace(req.Description)
	req.Changelog = strings.TrimSpace(req.Changelog)
	if req.TemplateID == "" {
		return CreateTemplateRequest{}, ValidationError("template_id is required")
	}
	if err := validateID("template_id", req.TemplateID); err != nil {
		return CreateTemplateRequest{}, ValidationWrap(err)
	}
	if req.Version == "" {
		return CreateTemplateRequest{}, ValidationError("version is required")
	}
	if !isValidVersionFormat(req.Version) {
		return CreateTemplateRequest{}, ValidationError(fmt.Sprintf("version %q must be in YYYY-MM-DD or YYYY-MM-DD.N format", req.Version))
	}
	kind := evalpkg.EvaluatorKind(req.Kind)
	if err := validateKind(kind); err != nil {
		return CreateTemplateRequest{}, ValidationWrap(err)
	}
	if err := validateOutputKeys(req.OutputKeys); err != nil {
		return CreateTemplateRequest{}, ValidationWrap(err)
	}
	if req.Config == nil {
		return CreateTemplateRequest{}, ValidationError("config is required")
	}
	req.Config = cloneMap(req.Config)
	if err := validateEvaluatorConfig(kind, req.Config, req.OutputKeys); err != nil {
		return CreateTemplateRequest{}, ValidationWrap(err)
	}
	return req, nil
}

func (r PublishVersionRequest) normalizeAndValidate(kind evalpkg.EvaluatorKind) (PublishVersionRequest, error) {
	req := r
	req.Version = strings.TrimSpace(req.Version)
	req.Changelog = strings.TrimSpace(req.Changelog)
	if req.Version == "" {
		return PublishVersionRequest{}, ValidationError("version is required")
	}
	if !isValidVersionFormat(req.Version) {
		return PublishVersionRequest{}, ValidationError(fmt.Sprintf("version %q must be in YYYY-MM-DD or YYYY-MM-DD.N format", req.Version))
	}
	if err := validateOutputKeys(req.OutputKeys); err != nil {
		return PublishVersionRequest{}, ValidationWrap(err)
	}
	if req.Config == nil {
		return PublishVersionRequest{}, ValidationError("config is required")
	}
	req.Config = cloneMap(req.Config)
	if err := validateEvaluatorConfig(kind, req.Config, req.OutputKeys); err != nil {
		return PublishVersionRequest{}, ValidationWrap(err)
	}
	return req, nil
}

func (r ForkTemplateRequest) normalizeAndValidate(kind evalpkg.EvaluatorKind) (ForkTemplateRequest, error) {
	req := r
	req.EvaluatorID = strings.TrimSpace(req.EvaluatorID)
	req.Version = strings.TrimSpace(req.Version)
	if req.EvaluatorID == "" {
		return ForkTemplateRequest{}, ValidationError("evaluator_id is required")
	}
	if err := validateID("evaluator_id", req.EvaluatorID); err != nil {
		return ForkTemplateRequest{}, ValidationWrap(err)
	}
	req.Config = cloneMap(req.Config)
	if len(req.Config) > 0 {
		if err := validateEvaluatorConfigOverrides(kind, req.Config); err != nil {
			return ForkTemplateRequest{}, ValidationWrap(err)
		}
	}
	if len(req.OutputKeys) > 0 {
		if err := validateOutputKeys(req.OutputKeys); err != nil {
			return ForkTemplateRequest{}, ValidationWrap(err)
		}
	}
	return req, nil
}

func (r EvalTestRequest) normalizeAndValidate() (EvalTestRequest, error) {
	req := r
	kind := evalpkg.EvaluatorKind(strings.TrimSpace(req.Kind))
	if err := validateKind(kind); err != nil {
		return EvalTestRequest{}, ValidationWrap(err)
	}
	if strings.TrimSpace(req.GenerationID) == "" {
		return EvalTestRequest{}, ValidationError("generation_id is required")
	}
	if err := validateOutputKeys(req.OutputKeys); err != nil {
		return EvalTestRequest{}, ValidationWrap(err)
	}
	if req.Config == nil {
		return EvalTestRequest{}, ValidationError("config is required")
	}
	req.Config = cloneMap(req.Config)
	if err := validateEvaluatorConfig(kind, req.Config, req.OutputKeys); err != nil {
		return EvalTestRequest{}, ValidationWrap(err)
	}
	req.Kind = string(kind)
	req.GenerationID = strings.TrimSpace(req.GenerationID)
	return req, nil
}
