package query

import (
	"strings"
	"testing"
)

func TestParseFilterExpressionClassifiesRoutes(t *testing.T) {
	parsed, err := ParseFilterExpression(`model = "gpt-4o" generation_count >= 3 status = error resource.k8s.namespace.name = "prod"`)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if len(parsed.Terms) != 4 {
		t.Fatalf("expected 4 terms, got %d", len(parsed.Terms))
	}
	if len(parsed.TempoTerms) != 3 {
		t.Fatalf("expected 3 tempo terms, got %d", len(parsed.TempoTerms))
	}
	if len(parsed.MySQLTerms) != 1 {
		t.Fatalf("expected 1 mysql term, got %d", len(parsed.MySQLTerms))
	}
	if parsed.MySQLTerms[0].ResolvedKey != "generation_count" {
		t.Fatalf("expected mysql term to route to generation_count, got %q", parsed.MySQLTerms[0].ResolvedKey)
	}
}

func TestParseFilterExpressionRejectsUnknownKey(t *testing.T) {
	_, err := ParseFilterExpression(`unknown_key = "value"`)
	if err == nil {
		t.Fatalf("expected parse error for unknown key")
	}
}

func TestParseFilterExpressionSupportsQuotedValuesWithSpaces(t *testing.T) {
	parsed, err := ParseFilterExpression(`agent = "support assistant"`)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if len(parsed.TempoTerms) != 1 {
		t.Fatalf("expected one term, got %d", len(parsed.TempoTerms))
	}
	if parsed.TempoTerms[0].Value != "support assistant" {
		t.Fatalf("unexpected value: %q", parsed.TempoTerms[0].Value)
	}
	if !parsed.TempoTerms[0].WasQuoted {
		t.Fatalf("expected quoted value to be marked as quoted")
	}
}

func TestParseFilterExpressionSupportsEscapedQuotedValues(t *testing.T) {
	parsed, err := ParseFilterExpression(`span.custom = "foo\"bar"`)
	if err != nil {
		t.Fatalf("parse escaped quoted filter: %v", err)
	}
	if len(parsed.TempoTerms) != 1 {
		t.Fatalf("expected one term, got %d", len(parsed.TempoTerms))
	}
	if parsed.TempoTerms[0].Value != `foo"bar` {
		t.Fatalf("unexpected decoded value: %q", parsed.TempoTerms[0].Value)
	}
	if !parsed.TempoTerms[0].WasQuoted {
		t.Fatalf("expected escaped literal to be marked quoted")
	}
}

func TestNormalizeSelectFields(t *testing.T) {
	fields, err := NormalizeSelectFields([]string{"namespace", "resource.k8s.namespace.name", "span.gen_ai.usage.input_tokens"})
	if err != nil {
		t.Fatalf("normalize select fields: %v", err)
	}
	if len(fields) != 2 {
		t.Fatalf("expected deduped select fields, got %d", len(fields))
	}
	if fields[0].ResolvedKey != "resource.k8s.namespace.name" {
		t.Fatalf("unexpected first select field %q", fields[0].ResolvedKey)
	}
}

func TestBuildTraceQLIncludesBaseAndSelect(t *testing.T) {
	parsed, err := ParseFilterExpression(`model = "gpt-4o" status = error duration > 5s`)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	selectFields, err := NormalizeSelectFields([]string{"resource.k8s.namespace.name", "span.gen_ai.usage.input_tokens"})
	if err != nil {
		t.Fatalf("normalize select fields: %v", err)
	}

	traceQL, err := BuildTraceQL(parsed, selectFields)
	if err != nil {
		t.Fatalf("build traceql: %v", err)
	}

	requiredFragments := []string{
		"span.gen_ai.operation.name != \"\"",
		"span.gen_ai.request.model = \"gpt-4o\"",
		"span.error.type != \"\"",
		"duration > 5s",
		"select(span.sigil.generation.id",
		"span.sigil.conversation.title",
		"resource.k8s.namespace.name",
		"span.gen_ai.usage.input_tokens",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(traceQL, fragment) {
			t.Fatalf("traceql %q missing fragment %q", traceQL, fragment)
		}
	}
}

func TestBuildTraceQLToolFilterAddsExecuteToolPredicate(t *testing.T) {
	parsed, err := ParseFilterExpression(`tool.name = "weather"`)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}

	traceQL, err := BuildTraceQL(parsed, nil)
	if err != nil {
		t.Fatalf("build traceql: %v", err)
	}
	if !strings.Contains(traceQL, `span.gen_ai.operation.name = "execute_tool"`) {
		t.Fatalf("expected tool predicate in query: %s", traceQL)
	}
}

func TestBuildTraceQLEmptyFilterUsesSDKNameGuard(t *testing.T) {
	traceQL, err := BuildTraceQL(ParsedFilters{}, nil)
	if err != nil {
		t.Fatalf("build traceql: %v", err)
	}

	if !strings.Contains(traceQL, `span.sigil.sdk.name != ""`) {
		t.Fatalf("expected empty-filter sdk-name guard in query: %s", traceQL)
	}
	if strings.Contains(traceQL, `span.gen_ai.operation.name =~ "generateText|streamText"`) {
		t.Fatalf("empty-filter query must not hardcode operation names: %s", traceQL)
	}
}

func TestResolveTagKeyForTempo(t *testing.T) {
	tag, mysqlOnly, err := resolveTagKeyForTempo("model")
	if err != nil {
		t.Fatalf("resolve model tag: %v", err)
	}
	if mysqlOnly {
		t.Fatalf("model should not be mysql only")
	}
	if tag != "span.gen_ai.request.model" {
		t.Fatalf("expected model tempo tag, got %q", tag)
	}

	rawTag, mysqlOnly, err := resolveTagKeyForTempo("span.gen_ai.request.model")
	if err != nil {
		t.Fatalf("resolve raw span tag: %v", err)
	}
	if mysqlOnly {
		t.Fatalf("raw span tag should not be mysql only")
	}
	if rawTag != "span.gen_ai.request.model" {
		t.Fatalf("expected raw span tag to remain scoped, got %q", rawTag)
	}

	_, mysqlOnly, err = resolveTagKeyForTempo("generation_count")
	if err != nil {
		t.Fatalf("resolve generation_count tag: %v", err)
	}
	if !mysqlOnly {
		t.Fatalf("generation_count must be mysql-only")
	}
}
