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
	Rate float64 `yaml:"rate"`
}

type seedStore interface {
	CreateEvaluator(ctx context.Context, evaluator evalpkg.EvaluatorDefinition) error
	CreateRule(ctx context.Context, rule evalpkg.RuleDefinition) error
}

func LoadYAMLSeedFile(ctx context.Context, store seedStore, tenantID, path string) error {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return nil
	}
	payload, err := os.ReadFile(trimmedPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("read yaml seed file: %w", err)
	}
	return LoadYAMLSeed(ctx, store, tenantID, payload)
}

func LoadYAMLSeed(ctx context.Context, store seedStore, tenantID string, payload []byte) error {
	if store == nil {
		return errors.New("eval store is required")
	}
	if len(payload) == 0 {
		return nil
	}

	var seed yamlSeed
	if err := yaml.Unmarshal(payload, &seed); err != nil {
		return fmt.Errorf("decode yaml seed: %w", err)
	}

	evaluatorIDs := make(map[string]struct{}, len(seed.Evaluators))
	for _, item := range seed.Evaluators {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			return errors.New("yaml evaluator id is required")
		}
		if _, ok := evaluatorIDs[id]; ok {
			return fmt.Errorf("duplicate evaluator id %q", id)
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
		if err := store.CreateEvaluator(ctx, evaluator); err != nil {
			return err
		}
	}

	ruleIDs := make(map[string]struct{}, len(seed.Rules))
	for _, item := range seed.Rules {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			return errors.New("yaml rule id is required")
		}
		if _, ok := ruleIDs[id]; ok {
			return fmt.Errorf("duplicate rule id %q", id)
		}
		ruleIDs[id] = struct{}{}

		enabled := true
		if item.Enabled != nil {
			enabled = *item.Enabled
		}
		sampleRate := item.Sample.Rate
		if sampleRate == 0 {
			sampleRate = 1
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
		if err := store.CreateRule(ctx, rule); err != nil {
			return err
		}
	}

	return nil
}
