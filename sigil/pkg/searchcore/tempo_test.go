package searchcore

import "testing"

func TestGroupTempoSearchResponseAndOrdering(t *testing.T) {
	response := &TempoSearchResponse{
		Traces: []TempoTrace{
			{
				TraceID:           "trace-new",
				StartTimeUnixNano: "200",
				SpanSets: []TempoSpanSet{
					{
						Spans: []TempoSpan{
							{
								SpanID:        "span-1",
								DurationNanos: "10",
								Attributes: []TempoAttribute{
									attrString("gen_ai.conversation.id", "conv-1"),
									attrString("sigil.generation.id", "gen-1"),
									attrString("gen_ai.request.model", "gpt-4o"),
									attrString("gen_ai.agent.name", "assistant"),
									attrString("error.type", "provider_error"),
									attrDouble("span.custom.score", 1.5),
									attrBool("span.custom.flag", true),
									attrString("span.custom.label", "zeta"),
								},
							},
							{
								SpanID:        "span-2",
								DurationNanos: "20",
								Attributes: []TempoAttribute{
									attrString("span.gen_ai.conversation.id", "conv-1"),
									attrString("span.sigil.generation.id", "gen-2"),
									attrString("span.gen_ai.request.model", "gpt-4o-mini"),
									attrString("span.gen_ai.agent.name", "assistant"),
									attrDouble("span.custom.score", 2.0),
									attrBool("span.custom.flag", false),
									attrString("span.custom.label", "alpha"),
								},
							},
						},
					},
				},
			},
			{
				TraceID:           "trace-old",
				StartTimeUnixNano: "100",
				SpanSets: []TempoSpanSet{
					{
						Spans: []TempoSpan{
							{
								SpanID:        "span-3",
								DurationNanos: "30",
								Attributes: []TempoAttribute{
									attrString("gen_ai.conversation.id", "conv-2"),
									attrString("sigil.generation.id", "gen-3"),
									attrString("gen_ai.request.model", "gpt-4o"),
									attrString("gen_ai.agent.name", "copilot"),
								},
							},
						},
					},
				},
			},
		},
	}

	selectFields := []SelectField{
		{Key: "duration", ResolvedKey: "duration"},
		{Key: "score", ResolvedKey: "span.custom.score"},
		{Key: "flag", ResolvedKey: "span.custom.flag"},
		{Key: "label", ResolvedKey: "span.custom.label"},
	}

	grouped := GroupTempoSearchResponse(response, selectFields)
	if grouped.EarliestTraceStartNanos != 100 {
		t.Fatalf("expected earliest nanos=100, got %d", grouped.EarliestTraceStartNanos)
	}
	if len(grouped.Conversations) != 2 {
		t.Fatalf("expected 2 conversations, got %d", len(grouped.Conversations))
	}

	conv1 := grouped.Conversations["conv-1"]
	if conv1 == nil {
		t.Fatalf("expected conv-1 aggregate")
	}
	if conv1.ErrorCount != 1 {
		t.Fatalf("expected error count 1, got %d", conv1.ErrorCount)
	}
	if len(conv1.GenerationIDs) != 2 {
		t.Fatalf("expected 2 generation ids, got %d", len(conv1.GenerationIDs))
	}
	if len(conv1.Models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(conv1.Models))
	}
	if conv1.LatestTraceStartNanos != 200 {
		t.Fatalf("expected latest trace nanos 200, got %d", conv1.LatestTraceStartNanos)
	}

	selected := BuildSelectedResultMap(conv1.Selected)
	if selected == nil {
		t.Fatalf("expected selected result map")
	}
	if got, ok := selected["duration"].(float64); !ok || got != 30 {
		t.Fatalf("unexpected duration aggregation: %#v", selected["duration"])
	}
	if got, ok := selected["score"].(float64); !ok || got != 3.5 {
		t.Fatalf("unexpected score aggregation: %#v", selected["score"])
	}
	flags, ok := selected["flag"].([]string)
	if !ok || len(flags) != 2 || flags[0] != "false" || flags[1] != "true" {
		t.Fatalf("unexpected flag aggregation: %#v", selected["flag"])
	}
	labels, ok := selected["label"].([]string)
	if !ok || len(labels) != 2 || labels[0] != "alpha" || labels[1] != "zeta" {
		t.Fatalf("unexpected label aggregation: %#v", selected["label"])
	}

	orderedIDs := OrderTempoConversationIDs(grouped.Conversations)
	if len(orderedIDs) != 2 || orderedIDs[0] != "conv-1" || orderedIDs[1] != "conv-2" {
		t.Fatalf("unexpected order: %#v", orderedIDs)
	}
}

func TestBuildSelectedResultMap(t *testing.T) {
	if got := BuildSelectedResultMap(nil); got != nil {
		t.Fatalf("expected nil for nil selected map, got %#v", got)
	}
	if got := BuildSelectedResultMap(map[string]*TempoSelectedAggregation{
		"empty": nil,
	}); got != nil {
		t.Fatalf("expected nil for empty selected map, got %#v", got)
	}
}

func TestExtractStringSlice(t *testing.T) {
	values, err := ExtractStringSlice([]byte(`{"tagNames":[" b ","a"],"nested":{"tagNames":["a","c"]}}`), "tagNames")
	if err != nil {
		t.Fatalf("extract string slice with preferred keys: %v", err)
	}
	expected := []string{"a", "b", "c"}
	if len(values) != len(expected) {
		t.Fatalf("expected %d values, got %d", len(expected), len(values))
	}
	for idx, expectedValue := range expected {
		if values[idx] != expectedValue {
			t.Fatalf("unexpected value at %d: got %q expected %q", idx, values[idx], expectedValue)
		}
	}

	fallbackValues, err := ExtractStringSlice([]byte(`{"items":[{"value":"x"},{"nested":" y "},["x","z"]]}`), "missing")
	if err != nil {
		t.Fatalf("extract fallback string slice: %v", err)
	}
	fallbackExpected := []string{"x", "y", "z"}
	if len(fallbackValues) != len(fallbackExpected) {
		t.Fatalf("expected %d fallback values, got %d", len(fallbackExpected), len(fallbackValues))
	}
	for idx, expectedValue := range fallbackExpected {
		if fallbackValues[idx] != expectedValue {
			t.Fatalf("unexpected fallback value at %d: got %q expected %q", idx, fallbackValues[idx], expectedValue)
		}
	}

	if _, err := ExtractStringSlice([]byte("{invalid"), "tagNames"); err == nil {
		t.Fatalf("expected invalid json error")
	}
}

func TestParseUnixNanosAndNormalizeTempoTagKey(t *testing.T) {
	if got := ParseUnixNanos("123"); got != 123 {
		t.Fatalf("expected nanos 123, got %d", got)
	}
	if got := ParseUnixNanos("  "); got != 0 {
		t.Fatalf("expected nanos 0 for empty input, got %d", got)
	}
	if got := ParseUnixNanos("abc"); got != 0 {
		t.Fatalf("expected nanos 0 for invalid input, got %d", got)
	}

	if got := NormalizeTempoTagKey("span", "gen_ai.request.model"); got != "span.gen_ai.request.model" {
		t.Fatalf("unexpected normalized span key: %q", got)
	}
	if got := NormalizeTempoTagKey("resource", "resource.service.name"); got != "resource.service.name" {
		t.Fatalf("unexpected normalized resource key: %q", got)
	}
	if got := NormalizeTempoTagKey("span", " "); got != "" {
		t.Fatalf("expected empty normalized key, got %q", got)
	}
}

func attrString(key, value string) TempoAttribute {
	return TempoAttribute{
		Key: key,
		Value: TempoAttributeValue{
			fields: map[string]any{"stringValue": value},
		},
	}
}

func attrDouble(key string, value float64) TempoAttribute {
	return TempoAttribute{
		Key: key,
		Value: TempoAttributeValue{
			fields: map[string]any{"doubleValue": value},
		},
	}
}

func attrBool(key string, value bool) TempoAttribute {
	return TempoAttribute{
		Key: key,
		Value: TempoAttributeValue{
			fields: map[string]any{"boolValue": value},
		},
	}
}
