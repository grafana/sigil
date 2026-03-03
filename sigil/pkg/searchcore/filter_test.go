package searchcore

import (
	"strings"
	"testing"
)

func TestParseFilterExpressionRoutes(t *testing.T) {
	parsed, err := ParseFilterExpression(`model = "gpt-4o" generation_count >= 2 status = error`)
	if err != nil {
		t.Fatalf("parse filter expression: %v", err)
	}

	if parsed.Raw != `model = "gpt-4o" generation_count >= 2 status = error` {
		t.Fatalf("unexpected raw expression: %q", parsed.Raw)
	}
	if len(parsed.Terms) != 3 {
		t.Fatalf("expected 3 terms, got %d", len(parsed.Terms))
	}
	if len(parsed.TempoTerms) != 2 {
		t.Fatalf("expected 2 tempo terms, got %d", len(parsed.TempoTerms))
	}
	if len(parsed.MySQLTerms) != 1 {
		t.Fatalf("expected 1 mysql term, got %d", len(parsed.MySQLTerms))
	}

	mysqlTerm := parsed.MySQLTerms[0]
	if mysqlTerm.ResolvedKey != "generation_count" || mysqlTerm.Route != FilterRouteMySQL {
		t.Fatalf("unexpected mysql term: %#v", mysqlTerm)
	}

	statusTerm := parsed.Terms[2]
	if statusTerm.RawKey != "status" || statusTerm.ResolvedKey != "span.error.type" {
		t.Fatalf("unexpected status term: %#v", statusTerm)
	}
}

func TestParseFilterExpressionErrors(t *testing.T) {
	testCases := []struct {
		name        string
		expression  string
		errContains string
	}{
		{
			name:        "unknown key",
			expression:  `unknown = foo`,
			errContains: `unknown filter key`,
		},
		{
			name:        "missing operator",
			expression:  `model "gpt-4o"`,
			errContains: `expected filter operator`,
		},
		{
			name:        "unterminated quoted value",
			expression:  `model = "gpt-4o`,
			errContains: `unterminated quoted`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseFilterExpression(tc.expression)
			if err == nil {
				t.Fatalf("expected error")
			}
			if !strings.Contains(err.Error(), tc.errContains) {
				t.Fatalf("expected error %q, got %q", tc.errContains, err.Error())
			}
		})
	}
}

func TestParseFilterExpressionSupportsEscapedQuotedValues(t *testing.T) {
	parsed, err := ParseFilterExpression(`span.custom = "foo\"bar"`)
	if err != nil {
		t.Fatalf("parse escaped quoted filter: %v", err)
	}
	if len(parsed.Terms) != 1 {
		t.Fatalf("expected 1 term, got %d", len(parsed.Terms))
	}
	if parsed.Terms[0].Value != `foo"bar` {
		t.Fatalf("unexpected decoded value: %q", parsed.Terms[0].Value)
	}
	if !parsed.Terms[0].WasQuoted {
		t.Fatalf("expected escaped literal to be marked quoted")
	}

	parsed, err = ParseFilterExpression(`span.custom = "foo\\bar"`)
	if err != nil {
		t.Fatalf("parse escaped backslash filter: %v", err)
	}
	if parsed.Terms[0].Value != `foo\bar` {
		t.Fatalf("unexpected decoded backslash value: %q", parsed.Terms[0].Value)
	}
}

func TestNormalizeSelectFields(t *testing.T) {
	fields, err := NormalizeSelectFields([]string{" model ", "span.custom", "model", "", "span.custom"})
	if err != nil {
		t.Fatalf("normalize select fields: %v", err)
	}
	if len(fields) != 2 {
		t.Fatalf("expected 2 fields, got %d", len(fields))
	}
	if fields[0].ResolvedKey != "span.gen_ai.request.model" {
		t.Fatalf("unexpected first field: %#v", fields[0])
	}
	if fields[1].ResolvedKey != "span.custom" {
		t.Fatalf("unexpected second field: %#v", fields[1])
	}

	_, err = NormalizeSelectFields([]string{"generation_count"})
	if err == nil || !strings.Contains(err.Error(), "not Tempo-backed") {
		t.Fatalf("expected tempo-backed error, got %v", err)
	}
}

func TestBuildTraceQL(t *testing.T) {
	mysqlOnlyFilters, err := ParseFilterExpression(`generation_count >= 2`)
	if err != nil {
		t.Fatalf("parse mysql-only filters: %v", err)
	}
	query, err := BuildTraceQL(mysqlOnlyFilters, nil)
	if err != nil {
		t.Fatalf("build traceql: %v", err)
	}
	if !strings.Contains(query, `span.sigil.sdk.name != ""`) {
		t.Fatalf("expected sdk-name guard in mysql-only query, got %q", query)
	}

	statusFilters, err := ParseFilterExpression(`status = error`)
	if err != nil {
		t.Fatalf("parse status filters: %v", err)
	}
	query, err = BuildTraceQL(statusFilters, nil)
	if err != nil {
		t.Fatalf("build status traceql: %v", err)
	}
	if !strings.Contains(query, `span.error.type != ""`) {
		t.Fatalf("expected status predicate in query, got %q", query)
	}

	toolFilters, err := ParseFilterExpression(`tool.name = "calendar"`)
	if err != nil {
		t.Fatalf("parse tool filters: %v", err)
	}
	query, err = BuildTraceQL(toolFilters, nil)
	if err != nil {
		t.Fatalf("build tool traceql: %v", err)
	}
	if !strings.Contains(query, `span.gen_ai.tool.name = "calendar"`) {
		t.Fatalf("expected tool predicate in query, got %q", query)
	}
	if !strings.Contains(query, `span.gen_ai.operation.name = "execute_tool"`) {
		t.Fatalf("expected execute_tool guard in query, got %q", query)
	}
}

func TestResolveTagKeyForTempo(t *testing.T) {
	testCases := []struct {
		name           string
		input          string
		expectedTag    string
		expectedMySQL  bool
		expectedErrSub string
	}{
		{
			name:          "well known tempo",
			input:         "model",
			expectedTag:   "span.gen_ai.request.model",
			expectedMySQL: false,
		},
		{
			name:          "well known mysql-only",
			input:         "generation_count",
			expectedTag:   "",
			expectedMySQL: true,
		},
		{
			name:          "explicit span key",
			input:         "span.gen_ai.request.model",
			expectedTag:   "span.gen_ai.request.model",
			expectedMySQL: false,
		},
		{
			name:          "explicit resource key",
			input:         "resource.k8s.namespace.name",
			expectedTag:   "resource.k8s.namespace.name",
			expectedMySQL: false,
		},
		{
			name:           "missing tag",
			input:          "",
			expectedErrSub: "tag is required",
		},
		{
			name:           "invalid explicit span key",
			input:          "span.",
			expectedErrSub: "unknown tag",
		},
		{
			name:           "unknown key",
			input:          "foo",
			expectedErrSub: "unknown tag",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			tag, mysqlOnly, err := ResolveTagKeyForTempo(tc.input)
			if tc.expectedErrSub != "" {
				if err == nil || !strings.Contains(err.Error(), tc.expectedErrSub) {
					t.Fatalf("expected error %q, got %v", tc.expectedErrSub, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolve tag key: %v", err)
			}
			if tag != tc.expectedTag {
				t.Fatalf("expected tag %q, got %q", tc.expectedTag, tag)
			}
			if mysqlOnly != tc.expectedMySQL {
				t.Fatalf("expected mysqlOnly=%v, got %v", tc.expectedMySQL, mysqlOnly)
			}
		})
	}
}

func TestWellKnownSearchTagsSorted(t *testing.T) {
	tags := WellKnownSearchTags()
	if len(tags) == 0 {
		t.Fatalf("expected non-empty tags")
	}
	for idx := 1; idx < len(tags); idx++ {
		if tags[idx-1].Key > tags[idx].Key {
			t.Fatalf("tags are not sorted: %q > %q", tags[idx-1].Key, tags[idx].Key)
		}
	}

	foundGenerationCount := false
	for _, tag := range tags {
		if tag.Key == "generation_count" {
			foundGenerationCount = true
			if tag.Scope != "well-known" {
				t.Fatalf("unexpected generation_count scope: %q", tag.Scope)
			}
		}
	}
	if !foundGenerationCount {
		t.Fatalf("expected generation_count tag")
	}
}

func TestMySQLFilterValidationAndMatch(t *testing.T) {
	validTerms, err := ParseFilterExpression(`generation_count >= 2 generation_count < 5`)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if err := ValidateMySQLFilterTerms(validTerms.MySQLTerms); err != nil {
		t.Fatalf("validate mysql terms: %v", err)
	}
	if !MatchesGenerationCountFilters(3, validTerms.MySQLTerms) {
		t.Fatalf("expected generation_count=3 to match")
	}
	if MatchesGenerationCountFilters(5, validTerms.MySQLTerms) {
		t.Fatalf("expected generation_count=5 to not match")
	}
	if MatchesGenerationCountFilters(1, validTerms.MySQLTerms) {
		t.Fatalf("expected generation_count=1 to not match")
	}

	invalidOperator := []FilterTerm{{
		ResolvedKey: "generation_count",
		Operator:    FilterOperatorRegex,
		Value:       "2",
	}}
	if err := ValidateMySQLFilterTerms(invalidOperator); err == nil {
		t.Fatalf("expected invalid operator error")
	}

	invalidValue := []FilterTerm{{
		ResolvedKey: "generation_count",
		Operator:    FilterOperatorGreaterThanOrEqual,
		Value:       "abc",
	}}
	if err := ValidateMySQLFilterTerms(invalidValue); err == nil {
		t.Fatalf("expected invalid value error")
	}
	if MatchesGenerationCountFilters(3, invalidValue) {
		t.Fatalf("expected invalid value filter to not match")
	}
}
