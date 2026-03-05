package searchcore

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// TempoSearchResponse is the Tempo /api/search JSON payload.
type TempoSearchResponse struct {
	Traces  []TempoTrace   `json:"traces"`
	Metrics map[string]any `json:"metrics,omitempty"`
}

// TempoTrace is one Tempo trace search result.
type TempoTrace struct {
	TraceID           string         `json:"traceID"`
	StartTimeUnixNano string         `json:"startTimeUnixNano"`
	SpanSets          []TempoSpanSet `json:"spanSets"`
}

// TempoSpanSet is one Tempo span-set container.
type TempoSpanSet struct {
	Spans []TempoSpan `json:"spans"`
}

// TempoSpan is one Tempo span result.
type TempoSpan struct {
	SpanID            string           `json:"spanID"`
	StartTimeUnixNano string           `json:"startTimeUnixNano"`
	DurationNanos     string           `json:"durationNanos"`
	Attributes        []TempoAttribute `json:"attributes"`
}

// TempoAttribute is one key/value attribute from Tempo search results.
type TempoAttribute struct {
	Key   string              `json:"key"`
	Value TempoAttributeValue `json:"value"`
}

// TempoAttributeValue normalizes Tempo's polymorphic value representation.
type TempoAttributeValue struct {
	fields map[string]any
}

// UnmarshalJSON decodes a Tempo attribute value object.
func (v *TempoAttributeValue) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		v.fields = nil
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return err
	}
	v.fields = out
	return nil
}

func (v TempoAttributeValue) StringValue() (string, bool) {
	for _, key := range []string{"stringValue", "value"} {
		candidate, ok := v.lookup(key)
		if !ok {
			continue
		}
		if asString, ok := candidate.(string); ok {
			return asString, true
		}
	}
	if numeric, ok := v.FloatValue(); ok {
		return strconv.FormatFloat(numeric, 'f', -1, 64), true
	}
	if boolean, ok := v.BoolValue(); ok {
		if boolean {
			return "true", true
		}
		return "false", true
	}
	return "", false
}

func (v TempoAttributeValue) FloatValue() (float64, bool) {
	for _, key := range []string{"doubleValue", "intValue", "numberValue", "value"} {
		candidate, ok := v.lookup(key)
		if !ok {
			continue
		}
		switch typed := candidate.(type) {
		case float64:
			return typed, true
		case float32:
			return float64(typed), true
		case int:
			return float64(typed), true
		case int64:
			return float64(typed), true
		case json.Number:
			parsed, err := typed.Float64()
			if err != nil {
				continue
			}
			return parsed, true
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
			if err != nil {
				continue
			}
			return parsed, true
		}
	}
	return 0, false
}

func (v TempoAttributeValue) BoolValue() (bool, bool) {
	for _, key := range []string{"boolValue", "value"} {
		candidate, ok := v.lookup(key)
		if !ok {
			continue
		}
		switch typed := candidate.(type) {
		case bool:
			return typed, true
		case string:
			parsed, err := strconv.ParseBool(strings.TrimSpace(typed))
			if err != nil {
				continue
			}
			return parsed, true
		}
	}
	return false, false
}

func (v TempoAttributeValue) lookup(key string) (any, bool) {
	if v.fields == nil {
		return nil, false
	}
	value, ok := v.fields[key]
	return value, ok
}

// TempoSelectedAggregation captures selected projection aggregation per key.
type TempoSelectedAggregation struct {
	DistinctValues map[string]struct{}
	NumericSum     float64
	HasNumeric     bool
}

// TempoConversationAggregate is grouped per-conversation Tempo search data.
type TempoConversationAggregate struct {
	ConversationID        string
	GenerationIDs         map[string]struct{}
	TraceIDs              map[string]struct{}
	Models                map[string]struct{}
	Agents                map[string]struct{}
	UserID                string
	ErrorCount            int
	Selected              map[string]*TempoSelectedAggregation
	LatestTraceStartNanos int64
	LatestUserIDAtNanos   int64
}

// TempoGroupResult is the grouped output of GroupTempoSearchResponse.
type TempoGroupResult struct {
	Conversations           map[string]*TempoConversationAggregate
	EarliestTraceStartNanos int64
}

// GroupTempoSearchResponse aggregates Tempo spans into conversation rows.
func GroupTempoSearchResponse(response *TempoSearchResponse, selectFields []SelectField) TempoGroupResult {
	result := TempoGroupResult{
		Conversations: make(map[string]*TempoConversationAggregate),
	}
	if response == nil {
		return result
	}

	for _, trace := range response.Traces {
		traceStartNanos := ParseUnixNanos(trace.StartTimeUnixNano)
		if traceStartNanos > 0 {
			if result.EarliestTraceStartNanos == 0 || traceStartNanos < result.EarliestTraceStartNanos {
				result.EarliestTraceStartNanos = traceStartNanos
			}
		}

		for _, spanSet := range trace.SpanSets {
			for _, span := range spanSet.Spans {
				spanStartNanos := ParseUnixNanos(span.StartTimeUnixNano)
				if spanStartNanos <= 0 {
					spanStartNanos = traceStartNanos
				}
				attributes := buildTempoAttributeLookup(span.Attributes)
				conversationID := firstAttributeString(attributes,
					"gen_ai.conversation.id",
					"span.gen_ai.conversation.id",
				)
				if strings.TrimSpace(conversationID) == "" {
					continue
				}

				aggregate, ok := result.Conversations[conversationID]
				if !ok {
					aggregate = &TempoConversationAggregate{
						ConversationID: conversationID,
						GenerationIDs:  make(map[string]struct{}),
						TraceIDs:       make(map[string]struct{}),
						Models:         make(map[string]struct{}),
						Agents:         make(map[string]struct{}),
						Selected:       make(map[string]*TempoSelectedAggregation),
					}
					result.Conversations[conversationID] = aggregate
				}

				if strings.TrimSpace(trace.TraceID) != "" {
					aggregate.TraceIDs[trace.TraceID] = struct{}{}
				}
				if traceStartNanos > aggregate.LatestTraceStartNanos {
					aggregate.LatestTraceStartNanos = traceStartNanos
				}

				if generationID := firstAttributeString(attributes, "sigil.generation.id", "span.sigil.generation.id"); generationID != "" {
					aggregate.GenerationIDs[generationID] = struct{}{}
				}
				if model := firstAttributeString(attributes, "gen_ai.request.model", "span.gen_ai.request.model"); model != "" {
					aggregate.Models[model] = struct{}{}
				}
				if agent := firstAttributeString(attributes, "gen_ai.agent.name", "span.gen_ai.agent.name"); agent != "" {
					aggregate.Agents[agent] = struct{}{}
				}
				if userID := firstAttributeString(attributes, "user.id", "span.user.id"); userID != "" {
					if spanStartNanos >= aggregate.LatestUserIDAtNanos {
						aggregate.UserID = userID
						aggregate.LatestUserIDAtNanos = spanStartNanos
					}
				}
				if errorType := firstAttributeString(attributes, "error.type", "span.error.type"); errorType != "" {
					aggregate.ErrorCount++
				}

				for _, field := range selectFields {
					selection := getOrCreateTempoSelectedAggregation(aggregate.Selected, field.Key)
					if field.ResolvedKey == "duration" {
						durationNanos := ParseUnixNanos(span.DurationNanos)
						if durationNanos > 0 {
							selection.NumericSum += float64(durationNanos)
							selection.HasNumeric = true
						}
						continue
					}

					attributeValue, ok := attributes[field.ResolvedKey]
					if !ok {
						continue
					}
					if numeric, ok := attributeValue.FloatValue(); ok {
						selection.NumericSum += numeric
						selection.HasNumeric = true
						continue
					}
					if asString, ok := attributeValue.StringValue(); ok {
						selection.DistinctValues[asString] = struct{}{}
						continue
					}
					if asBool, ok := attributeValue.BoolValue(); ok {
						if asBool {
							selection.DistinctValues["true"] = struct{}{}
						} else {
							selection.DistinctValues["false"] = struct{}{}
						}
					}
				}
			}
		}
	}

	return result
}

func getOrCreateTempoSelectedAggregation(target map[string]*TempoSelectedAggregation, key string) *TempoSelectedAggregation {
	item, ok := target[key]
	if ok {
		return item
	}
	item = &TempoSelectedAggregation{DistinctValues: make(map[string]struct{})}
	target[key] = item
	return item
}

func buildTempoAttributeLookup(attributes []TempoAttribute) map[string]TempoAttributeValue {
	lookup := make(map[string]TempoAttributeValue, len(attributes)*3)
	for _, attribute := range attributes {
		key := strings.TrimSpace(attribute.Key)
		if key == "" {
			continue
		}
		lookup[key] = attribute.Value

		if strings.HasPrefix(key, "span.") {
			lookup[strings.TrimPrefix(key, "span.")] = attribute.Value
		} else {
			lookup["span."+key] = attribute.Value
		}
		if strings.HasPrefix(key, "resource.") {
			lookup[strings.TrimPrefix(key, "resource.")] = attribute.Value
		} else {
			lookup["resource."+key] = attribute.Value
		}
	}
	return lookup
}

func firstAttributeString(attributes map[string]TempoAttributeValue, keys ...string) string {
	for _, key := range keys {
		if value, ok := attributes[key]; ok {
			if asString, ok := value.StringValue(); ok {
				return strings.TrimSpace(asString)
			}
		}
	}
	return ""
}

// ParseUnixNanos parses a string nanosecond timestamp.
func ParseUnixNanos(raw string) int64 {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0
	}
	parsed, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

// OrderTempoConversationIDs returns conversation IDs sorted by recency.
func OrderTempoConversationIDs(conversations map[string]*TempoConversationAggregate) []string {
	ids := make([]string, 0, len(conversations))
	for conversationID := range conversations {
		ids = append(ids, conversationID)
	}
	sort.Slice(ids, func(i, j int) bool {
		left := conversations[ids[i]]
		right := conversations[ids[j]]
		if left.LatestTraceStartNanos == right.LatestTraceStartNanos {
			return ids[i] < ids[j]
		}
		return left.LatestTraceStartNanos > right.LatestTraceStartNanos
	})
	return ids
}

// BuildSelectedResultMap projects selected aggregations to response JSON shape.
func BuildSelectedResultMap(selected map[string]*TempoSelectedAggregation) map[string]any {
	if len(selected) == 0 {
		return nil
	}
	out := make(map[string]any, len(selected))
	for key, aggregation := range selected {
		if aggregation == nil {
			continue
		}
		if aggregation.HasNumeric {
			out[key] = aggregation.NumericSum
			continue
		}
		if len(aggregation.DistinctValues) == 0 {
			continue
		}
		out[key] = SortedKeysFromSet(aggregation.DistinctValues)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// SortedKeysFromSet converts a set to sorted stable values.
func SortedKeysFromSet(values map[string]struct{}) []string {
	if len(values) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

// ExtractStringSlice extracts and normalizes string values from nested JSON payloads.
func ExtractStringSlice(payload []byte, preferredKeys ...string) ([]string, error) {
	var raw any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, fmt.Errorf("decode tempo response: %w", err)
	}

	results := make([]string, 0)
	for _, key := range preferredKeys {
		results = append(results, extractStringsForKey(raw, key)...)
	}
	if len(results) > 0 {
		return DedupeAndSortStrings(results), nil
	}

	results = append(results, extractAllStrings(raw)...)
	return DedupeAndSortStrings(results), nil
}

func extractStringsForKey(value any, key string) []string {
	switch typed := value.(type) {
	case map[string]any:
		out := make([]string, 0)
		for currentKey, currentValue := range typed {
			if currentKey == key {
				out = append(out, extractAllStrings(currentValue)...)
				continue
			}
			out = append(out, extractStringsForKey(currentValue, key)...)
		}
		return out
	case []any:
		out := make([]string, 0)
		for _, item := range typed {
			out = append(out, extractStringsForKey(item, key)...)
		}
		return out
	default:
		return nil
	}
}

func extractAllStrings(value any) []string {
	switch typed := value.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil
		}
		return []string{trimmed}
	case map[string]any:
		out := make([]string, 0)
		if nestedValue, ok := typed["value"]; ok {
			out = append(out, extractAllStrings(nestedValue)...)
		}
		for _, nested := range typed {
			out = append(out, extractAllStrings(nested)...)
		}
		return out
	case []any:
		out := make([]string, 0)
		for _, nested := range typed {
			out = append(out, extractAllStrings(nested)...)
		}
		return out
	default:
		return nil
	}
}

// NormalizeTempoTagKey applies a scope prefix when Tempo omits it.
func NormalizeTempoTagKey(scope string, key string) string {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "span.") || strings.HasPrefix(trimmed, "resource.") {
		return trimmed
	}
	return strings.TrimSpace(scope) + "." + trimmed
}
