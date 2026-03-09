package evaluators

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

type RegexEvaluator struct{}

func NewRegexEvaluator() *RegexEvaluator {
	return &RegexEvaluator{}
}

func (e *RegexEvaluator) Kind() evalpkg.EvaluatorKind {
	return evalpkg.EvaluatorKindRegex
}

func (e *RegexEvaluator) Evaluate(_ context.Context, input EvalInput, definition evalpkg.EvaluatorDefinition) ([]ScoreOutput, error) {
	patterns := extractRegexPatterns(definition.Config)
	if len(patterns) == 0 {
		return nil, evalpkg.Permanent(fmt.Errorf("regex evaluator requires pattern or patterns config"))
	}

	compiled := make([]*regexp.Regexp, 0, len(patterns))
	for _, pattern := range patterns {
		re, err := regexp.Compile(pattern)
		if err != nil {
			return nil, evalpkg.Permanent(fmt.Errorf("compile regex pattern %q: %w", pattern, err))
		}
		compiled = append(compiled, re)
	}

	matched := false
	for _, re := range compiled {
		if re.MatchString(input.ResponseText) {
			matched = true
			break
		}
	}

	rejectMatches := configBool(definition.Config, "reject", false)
	passed := matched
	if rejectMatches {
		passed = !matched
	}

	meta := firstOutputKey(definition, "regex_match", evalpkg.ScoreTypeBool)
	if meta.Type != evalpkg.ScoreTypeBool {
		return nil, evalpkg.Permanent(fmt.Errorf("regex evaluator output key %q must be bool", meta.Key))
	}
	return []ScoreOutput{{
		Key:      meta.Key,
		Type:     evalpkg.ScoreTypeBool,
		Value:    evalpkg.BoolValue(passed),
		Unit:     meta.Unit,
		Passed:   boolPointer(passed),
		Metadata: map[string]any{"patterns": patterns, "reject": rejectMatches, "matched": matched},
	}}, nil
}

func extractRegexPatterns(config map[string]any) []string {
	if config == nil {
		return nil
	}
	if pattern, ok := config["pattern"].(string); ok && strings.TrimSpace(pattern) != "" {
		return []string{strings.TrimSpace(pattern)}
	}
	if rawPatterns, ok := config["patterns"]; ok {
		switch typed := rawPatterns.(type) {
		case []string:
			out := make([]string, 0, len(typed))
			for _, pattern := range typed {
				if trimmed := strings.TrimSpace(pattern); trimmed != "" {
					out = append(out, trimmed)
				}
			}
			return out
		case []any:
			out := make([]string, 0, len(typed))
			for _, value := range typed {
				asString, ok := value.(string)
				if !ok {
					continue
				}
				if trimmed := strings.TrimSpace(asString); trimmed != "" {
					out = append(out, trimmed)
				}
			}
			return out
		}
	}
	return nil
}
