package searchcore

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// FilterRoute identifies which backend should evaluate a filter term.
type FilterRoute string

const (
	// FilterRouteTempo indicates a term is evaluated in Tempo/TraceQL.
	FilterRouteTempo FilterRoute = "tempo"
	// FilterRouteMySQL indicates a term is evaluated against conversation metadata.
	FilterRouteMySQL FilterRoute = "mysql"
)

// FilterOperator is the operator token from the user filter expression.
type FilterOperator string

const (
	FilterOperatorEqual              FilterOperator = "="
	FilterOperatorNotEqual           FilterOperator = "!="
	FilterOperatorGreaterThan        FilterOperator = ">"
	FilterOperatorLessThan           FilterOperator = "<"
	FilterOperatorGreaterThanOrEqual FilterOperator = ">="
	FilterOperatorLessThanOrEqual    FilterOperator = "<="
	FilterOperatorRegex              FilterOperator = "=~"
)

// FilterTerm is a normalized key/operator/value filter token.
type FilterTerm struct {
	RawKey      string
	ResolvedKey string
	Route       FilterRoute
	Operator    FilterOperator
	Value       string
	WasQuoted   bool
}

// ParsedFilters is a parsed filter expression split by execution route.
type ParsedFilters struct {
	Raw        string
	Terms      []FilterTerm
	TempoTerms []FilterTerm
	MySQLTerms []FilterTerm
}

// SelectField is a normalized search projection field.
type SelectField struct {
	Key         string
	ResolvedKey string
}

// SearchTag describes one searchable key exposed to UI autocomplete.
type SearchTag struct {
	Key         string `json:"key"`
	Scope       string `json:"scope"`
	Description string `json:"description"`
}

type filterKeyDefinition struct {
	Route           FilterRoute
	TempoKey        string
	Description     string
	MySQLField      string
	IsStatusAlias   bool
	IsToolAttribute bool
}

var (
	wellKnownFilterDefinitions = map[string]filterKeyDefinition{
		"model": {
			Route:       FilterRouteTempo,
			TempoKey:    "span.gen_ai.request.model",
			Description: "Model name",
		},
		"provider": {
			Route:       FilterRouteTempo,
			TempoKey:    "span.gen_ai.provider.name",
			Description: "Provider name",
		},
		"agent": {
			Route:       FilterRouteTempo,
			TempoKey:    "span.gen_ai.agent.name",
			Description: "Agent name",
		},
		"agent.version": {
			Route:       FilterRouteTempo,
			TempoKey:    "span.gen_ai.agent.version",
			Description: "Agent version",
		},
		"status": {
			Route:         FilterRouteTempo,
			TempoKey:      "span.error.type",
			Description:   "Error status",
			IsStatusAlias: true,
		},
		"error.type": {
			Route:       FilterRouteTempo,
			TempoKey:    "span.error.type",
			Description: "Error type",
		},
		"error.category": {
			Route:       FilterRouteTempo,
			TempoKey:    "span.error.category",
			Description: "Error category",
		},
		"duration": {
			Route:       FilterRouteTempo,
			TempoKey:    "duration",
			Description: "Generation duration",
		},
		"tool.name": {
			Route:           FilterRouteTempo,
			TempoKey:        "span.gen_ai.tool.name",
			Description:     "Tool name",
			IsToolAttribute: true,
		},
		"operation": {
			Route:       FilterRouteTempo,
			TempoKey:    "span.gen_ai.operation.name",
			Description: "Operation name",
		},
		"namespace": {
			Route:       FilterRouteTempo,
			TempoKey:    "resource.k8s.namespace.name",
			Description: "Kubernetes namespace",
		},
		"cluster": {
			Route:       FilterRouteTempo,
			TempoKey:    "resource.k8s.cluster.name",
			Description: "Kubernetes cluster",
		},
		"service": {
			Route:       FilterRouteTempo,
			TempoKey:    "resource.service.name",
			Description: "Service name",
		},
		"generation_count": {
			Route:       FilterRouteMySQL,
			MySQLField:  "generation_count",
			Description: "Generations per conversation",
		},
	}

	defaultSelectFields = []string{
		"span.sigil.generation.id",
		"span.gen_ai.conversation.id",
		"span.gen_ai.request.model",
		"span.gen_ai.agent.name",
		"span.error.type",
		"span.error.category",
	}
)

// ParseFilterExpression parses user text into routed filter terms.
func ParseFilterExpression(expression string) (ParsedFilters, error) {
	trimmed := strings.TrimSpace(expression)
	if trimmed == "" {
		return ParsedFilters{Raw: ""}, nil
	}

	terms := make([]FilterTerm, 0)
	idx := 0
	for idx < len(trimmed) {
		skipSpaces(trimmed, &idx)
		if idx >= len(trimmed) {
			break
		}

		key, err := parseKeyToken(trimmed, &idx)
		if err != nil {
			return ParsedFilters{}, err
		}
		skipSpaces(trimmed, &idx)

		op, err := parseOperatorToken(trimmed, &idx)
		if err != nil {
			return ParsedFilters{}, err
		}
		skipSpaces(trimmed, &idx)

		value, quoted, err := parseValueToken(trimmed, &idx)
		if err != nil {
			return ParsedFilters{}, err
		}

		term, err := classifyFilterTerm(key, op, value, quoted)
		if err != nil {
			return ParsedFilters{}, err
		}
		terms = append(terms, term)

		skipSpaces(trimmed, &idx)
	}

	parsed := ParsedFilters{Raw: trimmed, Terms: terms}
	for _, term := range terms {
		switch term.Route {
		case FilterRouteTempo:
			parsed.TempoTerms = append(parsed.TempoTerms, term)
		case FilterRouteMySQL:
			parsed.MySQLTerms = append(parsed.MySQLTerms, term)
		}
	}

	return parsed, nil
}

// NormalizeSelectFields validates and de-duplicates caller requested select fields.
func NormalizeSelectFields(keys []string) ([]SelectField, error) {
	if len(keys) == 0 {
		return nil, nil
	}

	out := make([]SelectField, 0, len(keys))
	seen := make(map[string]struct{}, len(keys))
	for _, raw := range keys {
		key := strings.TrimSpace(raw)
		if key == "" {
			continue
		}

		resolved, route, err := resolveFilterKey(key)
		if err != nil {
			return nil, err
		}
		if route != FilterRouteTempo {
			return nil, fmt.Errorf("select key %q is not Tempo-backed", key)
		}
		if _, ok := seen[resolved]; ok {
			continue
		}
		seen[resolved] = struct{}{}
		out = append(out, SelectField{Key: key, ResolvedKey: resolved})
	}

	return out, nil
}

// BuildTraceQL compiles routed filters into a Tempo TraceQL query.
func BuildTraceQL(parsed ParsedFilters, selectFields []SelectField) (string, error) {
	predicates := []string{"span.gen_ai.operation.name != \"\""}
	if len(parsed.TempoTerms) == 0 {
		predicates = append(predicates, "span.sigil.sdk.name != \"\"")
	}

	hasToolFilter := false
	for _, term := range parsed.TempoTerms {
		predicate, isToolFilter, err := buildTraceQLPredicate(term)
		if err != nil {
			return "", err
		}
		if predicate != "" {
			predicates = append(predicates, predicate)
		}
		if isToolFilter {
			hasToolFilter = true
		}
	}
	if hasToolFilter {
		predicates = append(predicates, "span.gen_ai.operation.name = \"execute_tool\"")
	}

	selectParts := append([]string{}, defaultSelectFields...)
	seen := make(map[string]struct{}, len(selectParts))
	for _, part := range selectParts {
		seen[part] = struct{}{}
	}
	for _, field := range selectFields {
		resolved := strings.TrimSpace(field.ResolvedKey)
		if resolved == "" {
			continue
		}
		if _, ok := seen[resolved]; ok {
			continue
		}
		seen[resolved] = struct{}{}
		selectParts = append(selectParts, resolved)
	}

	return fmt.Sprintf("{ %s } | select(%s)", strings.Join(predicates, " && "), strings.Join(selectParts, ", ")), nil
}

// WellKnownSearchTags returns the canonical filter-key autocomplete entries.
func WellKnownSearchTags() []SearchTag {
	tags := make([]SearchTag, 0, len(wellKnownFilterDefinitions))
	for key, definition := range wellKnownFilterDefinitions {
		tags = append(tags, SearchTag{
			Key:         key,
			Scope:       "well-known",
			Description: definition.Description,
		})
	}
	sort.Slice(tags, func(i, j int) bool {
		return tags[i].Key < tags[j].Key
	})
	return tags
}

// ResolveTagKeyForTempo resolves a user-facing tag key to a full Tempo key.
//
// The second return value reports whether the key is metadata-only (MySQL-only)
// and should not trigger a Tempo tag-values request.
func ResolveTagKeyForTempo(rawKey string) (string, bool, error) {
	trimmed := strings.TrimSpace(rawKey)
	if trimmed == "" {
		return "", false, errors.New("tag is required")
	}

	if definition, ok := wellKnownFilterDefinitions[trimmed]; ok {
		if definition.Route == FilterRouteMySQL {
			return "", true, nil
		}
		return definition.TempoKey, false, nil
	}

	if strings.HasPrefix(trimmed, "span.") {
		if strings.TrimSpace(strings.TrimPrefix(trimmed, "span.")) == "" {
			return "", false, fmt.Errorf("unknown tag %q", trimmed)
		}
		return trimmed, false, nil
	}
	if strings.HasPrefix(trimmed, "resource.") {
		if strings.TrimSpace(strings.TrimPrefix(trimmed, "resource.")) == "" {
			return "", false, fmt.Errorf("unknown tag %q", trimmed)
		}
		return trimmed, false, nil
	}

	return "", false, fmt.Errorf("unknown tag %q", trimmed)
}

// ValidateMySQLFilterTerms validates metadata-routed filter terms.
func ValidateMySQLFilterTerms(terms []FilterTerm) error {
	for _, term := range terms {
		if term.ResolvedKey != "generation_count" {
			continue
		}
		switch term.Operator {
		case FilterOperatorEqual,
			FilterOperatorNotEqual,
			FilterOperatorGreaterThan,
			FilterOperatorLessThan,
			FilterOperatorGreaterThanOrEqual,
			FilterOperatorLessThanOrEqual:
		default:
			return errors.New("generation_count supports only numeric comparison operators")
		}
		if _, err := strconv.Atoi(strings.TrimSpace(term.Value)); err != nil {
			return errors.New("generation_count value must be an integer")
		}
	}
	return nil
}

// MatchesGenerationCountFilters evaluates generation_count terms for one row.
func MatchesGenerationCountFilters(generationCount int, terms []FilterTerm) bool {
	for _, term := range terms {
		if term.ResolvedKey != "generation_count" {
			continue
		}
		value, err := strconv.Atoi(strings.TrimSpace(term.Value))
		if err != nil {
			return false
		}

		switch term.Operator {
		case FilterOperatorEqual:
			if generationCount != value {
				return false
			}
		case FilterOperatorNotEqual:
			if generationCount == value {
				return false
			}
		case FilterOperatorGreaterThan:
			if generationCount <= value {
				return false
			}
		case FilterOperatorGreaterThanOrEqual:
			if generationCount < value {
				return false
			}
		case FilterOperatorLessThan:
			if generationCount >= value {
				return false
			}
		case FilterOperatorLessThanOrEqual:
			if generationCount > value {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func classifyFilterTerm(key string, operator FilterOperator, value string, quoted bool) (FilterTerm, error) {
	resolvedKey, route, err := resolveFilterKey(key)
	if err != nil {
		return FilterTerm{}, err
	}
	return FilterTerm{
		RawKey:      key,
		ResolvedKey: resolvedKey,
		Route:       route,
		Operator:    operator,
		Value:       value,
		WasQuoted:   quoted,
	}, nil
}

func resolveFilterKey(key string) (string, FilterRoute, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", "", errors.New("filter key is required")
	}

	if definition, ok := wellKnownFilterDefinitions[key]; ok {
		if definition.Route == FilterRouteMySQL {
			return definition.MySQLField, FilterRouteMySQL, nil
		}
		return definition.TempoKey, FilterRouteTempo, nil
	}
	if strings.HasPrefix(key, "span.") || strings.HasPrefix(key, "resource.") {
		return key, FilterRouteTempo, nil
	}
	return "", "", fmt.Errorf("unknown filter key %q", key)
}

func buildTraceQLPredicate(term FilterTerm) (string, bool, error) {
	if term.Route != FilterRouteTempo {
		return "", false, nil
	}

	if definition, ok := wellKnownFilterDefinitions[term.RawKey]; ok {
		if definition.IsStatusAlias {
			predicate, err := buildStatusPredicate(term.Operator, term.Value)
			return predicate, false, err
		}
		predicate, err := buildSimplePredicate(term)
		return predicate, definition.IsToolAttribute, err
	}

	predicate, err := buildSimplePredicate(term)
	return predicate, false, err
}

func buildStatusPredicate(operator FilterOperator, value string) (string, error) {
	normalizedValue := strings.ToLower(strings.TrimSpace(value))
	if normalizedValue == "" {
		return "", errors.New("status value is required")
	}

	if operator != FilterOperatorEqual && operator != FilterOperatorNotEqual {
		return "", errors.New("status filter only supports = and != operators")
	}

	isError := normalizedValue == "error"
	isOK := normalizedValue == "ok" || normalizedValue == "success"
	if !isError && !isOK {
		return "", errors.New("status value must be error or ok")
	}

	if operator == FilterOperatorEqual {
		if isError {
			return "span.error.type != \"\"", nil
		}
		return "span.error.type = \"\"", nil
	}

	if isError {
		return "span.error.type = \"\"", nil
	}
	return "span.error.type != \"\"", nil
}

func buildSimplePredicate(term FilterTerm) (string, error) {
	literal, err := traceQLLiteral(term)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s %s %s", term.ResolvedKey, term.Operator, literal), nil
}

func traceQLLiteral(term FilterTerm) (string, error) {
	if term.Operator == FilterOperatorRegex {
		return strconv.Quote(term.Value), nil
	}

	if term.ResolvedKey == "duration" {
		return term.Value, nil
	}

	if !term.WasQuoted && isUnquotedTraceQLLiteral(term.Value) {
		return term.Value, nil
	}
	return strconv.Quote(term.Value), nil
}

func isUnquotedTraceQLLiteral(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	if trimmed == "true" || trimmed == "false" {
		return true
	}
	if _, err := strconv.ParseFloat(trimmed, 64); err == nil {
		return true
	}
	if looksLikeDurationLiteral(trimmed) {
		return true
	}
	return false
}

func looksLikeDurationLiteral(value string) bool {
	if len(value) < 2 {
		return false
	}
	hasDigit := false
	hasUnit := false
	for _, ch := range value {
		switch {
		case unicode.IsDigit(ch):
			hasDigit = true
		case ch == '.' || ch == '-':
			continue
		case unicode.IsLetter(ch):
			hasUnit = true
		default:
			return false
		}
	}
	return hasDigit && hasUnit
}

func skipSpaces(input string, idx *int) {
	for *idx < len(input) {
		if !unicode.IsSpace(rune(input[*idx])) {
			return
		}
		*idx = *idx + 1
	}
}

func parseKeyToken(input string, idx *int) (string, error) {
	start := *idx
	for *idx < len(input) {
		ch := input[*idx]
		if unicode.IsSpace(rune(ch)) || strings.ContainsRune("=!<>", rune(ch)) {
			break
		}
		*idx = *idx + 1
	}
	if start == *idx {
		return "", errors.New("expected filter key")
	}
	key := strings.TrimSpace(input[start:*idx])
	if key == "" {
		return "", errors.New("expected filter key")
	}
	return key, nil
}

func parseOperatorToken(input string, idx *int) (FilterOperator, error) {
	operators := []string{"!=", ">=", "<=", "=~", "=", ">", "<"}
	for _, op := range operators {
		if strings.HasPrefix(input[*idx:], op) {
			*idx += len(op)
			return FilterOperator(op), nil
		}
	}
	return "", errors.New("expected filter operator")
}

func parseValueToken(input string, idx *int) (string, bool, error) {
	if *idx >= len(input) {
		return "", false, errors.New("filter value is required")
	}

	if input[*idx] == '"' {
		start := *idx
		*idx = *idx + 1
		escaped := false
		for *idx < len(input) {
			current := input[*idx]
			if escaped {
				escaped = false
				*idx = *idx + 1
				continue
			}
			if current == '\\' {
				escaped = true
				*idx = *idx + 1
				continue
			}
			if current == '"' {
				*idx = *idx + 1
				literal := input[start:*idx]
				decoded, err := strconv.Unquote(literal)
				if err != nil {
					return "", false, fmt.Errorf("invalid quoted value: %w", err)
				}
				return decoded, true, nil
			}
			*idx = *idx + 1
		}
		return "", false, errors.New("unterminated quoted filter value")
	}

	start := *idx
	for *idx < len(input) {
		if unicode.IsSpace(rune(input[*idx])) {
			break
		}
		*idx = *idx + 1
	}
	value := strings.TrimSpace(input[start:*idx])
	if value == "" {
		return "", false, errors.New("filter value is required")
	}
	return value, false, nil
}
