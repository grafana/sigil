package control

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"gopkg.in/yaml.v3"
)

type yamlSeed struct {
	Evaluators []yamlSeedEvaluator `yaml:"evaluators"`
	Rules      []yamlSeedRule      `yaml:"rules"`
}

type yamlSeedEvaluator struct {
	ID      string                  `yaml:"id"`
	Kind    string                  `yaml:"kind"`
	Version string                  `yaml:"version"`
	Config  map[string]any          `yaml:",inline"`
	Output  yamlSeedEvaluatorOutput `yaml:"output"`
}

type yamlSeedEvaluatorOutput struct {
	Keys []yamlSeedOutputKey `yaml:"keys"`
}

type yamlSeedOutputKey struct {
	Key  string `yaml:"key"`
	Type string `yaml:"type"`
	Unit string `yaml:"unit"`
}

type yamlSeedRule struct {
	ID         string             `yaml:"id"`
	Enabled    *bool              `yaml:"enabled"`
	Select     yamlSeedRuleSelect `yaml:"select"`
	Match      map[string]any     `yaml:"match"`
	Sample     yamlSeedRuleSample `yaml:"sample"`
	Evaluators []string           `yaml:"evaluators"`
}

type yamlSeedRuleSelect struct {
	Selector string `yaml:"selector"`
}

type yamlSeedRuleSample struct {
	Rate *float64 `yaml:"rate"`
}

type seedStore interface {
	CreateEvaluator(ctx context.Context, evaluator evalpkg.EvaluatorDefinition) error
	GetEvaluator(ctx context.Context, tenantID, evaluatorID string) (*evalpkg.EvaluatorDefinition, error)
	CreateRule(ctx context.Context, rule evalpkg.RuleDefinition) error
}

type SeedLoadOptions struct {
	Strict bool
}

type SeedLoadIssue struct {
	Entity string
	ID     string
	Error  string
}

type SeedLoadReport struct {
	CreatedEvaluators int
	CreatedRules      int
	SkippedEvaluators int
	SkippedRules      int
	Issues            []SeedLoadIssue
}

func (r SeedLoadReport) HasIssues() bool {
	return len(r.Issues) > 0
}

func (r *SeedLoadReport) addIssue(entity, id string, err error) {
	if r == nil || err == nil {
		return
	}
	r.Issues = append(r.Issues, SeedLoadIssue{
		Entity: strings.TrimSpace(entity),
		ID:     strings.TrimSpace(id),
		Error:  strings.TrimSpace(err.Error()),
	})
}

func LoadYAMLSeedFile(ctx context.Context, store seedStore, tenantID, path string) error {
	_, err := LoadYAMLSeedFileWithOptions(ctx, store, tenantID, path, SeedLoadOptions{Strict: true})
	return err
}

func LoadYAMLSeedFileWithOptions(ctx context.Context, store seedStore, tenantID, path string, options SeedLoadOptions) (SeedLoadReport, error) {
	report := SeedLoadReport{}

	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return report, nil
	}
	payload, err := os.ReadFile(trimmedPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return report, nil
		}
		wrapped := fmt.Errorf("read yaml seed file: %w", err)
		if options.Strict {
			return report, wrapped
		}
		report.addIssue("seed_file", trimmedPath, wrapped)
		return report, nil
	}
	return LoadYAMLSeedWithOptions(ctx, store, tenantID, payload, options)
}

func LoadYAMLSeed(ctx context.Context, store seedStore, tenantID string, payload []byte) error {
	_, err := LoadYAMLSeedWithOptions(ctx, store, tenantID, payload, SeedLoadOptions{Strict: true})
	return err
}

func LoadYAMLSeedWithOptions(ctx context.Context, store seedStore, tenantID string, payload []byte, options SeedLoadOptions) (SeedLoadReport, error) {
	report := SeedLoadReport{}

	if store == nil {
		return report, errors.New("eval store is required")
	}
	if len(payload) == 0 {
		return report, nil
	}

	var seed yamlSeed
	if err := yaml.Unmarshal(payload, &seed); err != nil {
		wrapped := fmt.Errorf("decode yaml seed: %w", err)
		if options.Strict {
			return report, wrapped
		}
		report.addIssue("seed", "decode", wrapped)
		return report, nil
	}

	evaluatorIDs := make(map[string]struct{}, len(seed.Evaluators))
	for _, item := range seed.Evaluators {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			report.SkippedEvaluators++
			err := errors.New("yaml evaluator id is required")
			if options.Strict {
				return report, err
			}
			report.addIssue("evaluator", id, err)
			continue
		}
		if _, ok := evaluatorIDs[id]; ok {
			report.SkippedEvaluators++
			err := fmt.Errorf("duplicate evaluator id %q", id)
			if options.Strict {
				return report, err
			}
			report.addIssue("evaluator", id, err)
			continue
		}
		evaluatorIDs[id] = struct{}{}

		version := strings.TrimSpace(item.Version)
		if version == "" {
			version = "seed"
		}

		config := make(map[string]any, len(item.Config))
		for key, value := range item.Config {
			if key == "id" || key == "kind" || key == "version" || key == "output" {
				continue
			}
			config[key] = value
		}

		outputKeys := make([]evalpkg.OutputKey, 0, len(item.Output.Keys))
		for _, key := range item.Output.Keys {
			outputKeys = append(outputKeys, evalpkg.OutputKey{
				Key:  strings.TrimSpace(key.Key),
				Type: evalpkg.ScoreType(strings.TrimSpace(key.Type)),
				Unit: strings.TrimSpace(key.Unit),
			})
		}
		if len(outputKeys) == 0 {
			outputKeys = append(outputKeys, evalpkg.OutputKey{Key: id, Type: evalpkg.ScoreTypeBool})
		}

		evaluator := evalpkg.EvaluatorDefinition{
			TenantID:    strings.TrimSpace(tenantID),
			EvaluatorID: id,
			Version:     version,
			Kind:        evalpkg.EvaluatorKind(strings.TrimSpace(item.Kind)),
			Config:      config,
			OutputKeys:  outputKeys,
		}
		if err := validateEvaluator(&evaluator); err != nil {
			report.SkippedEvaluators++
			if options.Strict {
				return report, err
			}
			report.addIssue("evaluator", id, err)
			continue
		}
		if err := store.CreateEvaluator(ctx, evaluator); err != nil {
			report.SkippedEvaluators++
			if options.Strict {
				return report, err
			}
			report.addIssue("evaluator", id, err)
			continue
		}
		report.CreatedEvaluators++
	}

	ruleIDs := make(map[string]struct{}, len(seed.Rules))
	for _, item := range seed.Rules {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			report.SkippedRules++
			err := errors.New("yaml rule id is required")
			if options.Strict {
				return report, err
			}
			report.addIssue("rule", id, err)
			continue
		}
		if _, ok := ruleIDs[id]; ok {
			report.SkippedRules++
			err := fmt.Errorf("duplicate rule id %q", id)
			if options.Strict {
				return report, err
			}
			report.addIssue("rule", id, err)
			continue
		}
		ruleIDs[id] = struct{}{}

		enabled := true
		if item.Enabled != nil {
			enabled = *item.Enabled
		}
		sampleRate := defaultRuleSampleRate
		if item.Sample.Rate != nil {
			sampleRate = *item.Sample.Rate
		}
		selector := strings.TrimSpace(item.Select.Selector)
		if selector == "" {
			selector = string(evalpkg.SelectorUserVisibleTurn)
		}

		rule := evalpkg.RuleDefinition{
			TenantID:     strings.TrimSpace(tenantID),
			RuleID:       id,
			Enabled:      enabled,
			Selector:     evalpkg.Selector(selector),
			Match:        item.Match,
			SampleRate:   sampleRate,
			EvaluatorIDs: item.Evaluators,
		}
		if err := validateRule(&rule); err != nil {
			report.SkippedRules++
			if options.Strict {
				return report, err
			}
			report.addIssue("rule", id, err)
			continue
		}
		skipRule := false
		for _, evaluatorID := range rule.EvaluatorIDs {
			evaluator, err := store.GetEvaluator(ctx, rule.TenantID, evaluatorID)
			if err != nil {
				report.SkippedRules++
				if options.Strict {
					return report, err
				}
				report.addIssue("rule", id, err)
				skipRule = true
				break
			}
			if evaluator == nil {
				report.SkippedRules++
				err := fmt.Errorf("yaml rule %q references unknown evaluator %q", rule.RuleID, evaluatorID)
				if options.Strict {
					return report, err
				}
				report.addIssue("rule", id, err)
				skipRule = true
				break
			}
		}
		if skipRule {
			continue
		}
		if err := store.CreateRule(ctx, rule); err != nil {
			report.SkippedRules++
			if options.Strict {
				return report, err
			}
			report.addIssue("rule", id, err)
			continue
		}
		report.CreatedRules++
	}

	return report, nil
}
