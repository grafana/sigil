package query

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGroupTempoSearchResponseAggregatesConversations(t *testing.T) {
	response := &TempoSearchResponse{
		Traces: []TempoTrace{
			{
				TraceID:           "trace-1",
				StartTimeUnixNano: "1739606400000000000",
				SpanSets: []TempoSpanSet{{
					Spans: []TempoSpan{{
						SpanID:        "span-1",
						DurationNanos: "1000000000",
						Attributes: []TempoAttribute{
							{Key: "sigil.generation.id", Value: tempoStringValue("gen-1")},
							{Key: "gen_ai.conversation.id", Value: tempoStringValue("conv-1")},
							{Key: "gen_ai.request.model", Value: tempoStringValue("gpt-4o")},
							{Key: "gen_ai.agent.name", Value: tempoStringValue("assistant")},
							{Key: "error.type", Value: tempoStringValue("provider_error")},
							{Key: "resource.k8s.namespace.name", Value: tempoStringValue("prod")},
							{Key: "span.gen_ai.usage.input_tokens", Value: tempoNumberValue(123)},
						},
					}},
				}},
			},
			{
				TraceID:           "trace-2",
				StartTimeUnixNano: "1739602800000000000",
				SpanSets: []TempoSpanSet{{
					Spans: []TempoSpan{{
						SpanID:        "span-2",
						DurationNanos: "500000000",
						Attributes: []TempoAttribute{
							{Key: "sigil.generation.id", Value: tempoStringValue("gen-2")},
							{Key: "gen_ai.conversation.id", Value: tempoStringValue("conv-1")},
							{Key: "gen_ai.request.model", Value: tempoStringValue("gpt-4o")},
							{Key: "gen_ai.agent.name", Value: tempoStringValue("assistant")},
							{Key: "resource.k8s.namespace.name", Value: tempoStringValue("prod")},
							{Key: "span.gen_ai.usage.input_tokens", Value: tempoNumberValue(77)},
						},
					}},
				}},
			},
		},
	}

	selectedFields := []SelectField{
		{Key: "resource.k8s.namespace.name", ResolvedKey: "resource.k8s.namespace.name"},
		{Key: "span.gen_ai.usage.input_tokens", ResolvedKey: "span.gen_ai.usage.input_tokens"},
	}

	grouped := groupTempoSearchResponse(response, selectedFields)
	aggregate, ok := grouped.Conversations["conv-1"]
	if !ok {
		t.Fatalf("expected grouped conversation conv-1")
	}
	if len(aggregate.GenerationIDs) != 2 {
		t.Fatalf("expected 2 generation ids, got %d", len(aggregate.GenerationIDs))
	}
	if len(aggregate.TraceIDs) != 2 {
		t.Fatalf("expected 2 trace ids, got %d", len(aggregate.TraceIDs))
	}
	if aggregate.ErrorCount != 1 {
		t.Fatalf("expected error count=1, got %d", aggregate.ErrorCount)
	}
	if aggregate.Selected["resource.k8s.namespace.name"] == nil {
		t.Fatalf("expected namespace aggregation")
	}
	if aggregate.Selected["span.gen_ai.usage.input_tokens"] == nil {
		t.Fatalf("expected token aggregation")
	}
	if aggregate.Selected["span.gen_ai.usage.input_tokens"].NumericSum != 200 {
		t.Fatalf("expected numeric sum=200, got %f", aggregate.Selected["span.gen_ai.usage.input_tokens"].NumericSum)
	}
	if grouped.EarliestTraceStartNanos != 1739602800000000000 {
		t.Fatalf("unexpected earliest trace nanos %d", grouped.EarliestTraceStartNanos)
	}
}

func TestGroupTempoSearchResponseConversationTitleUsesLatestSpan(t *testing.T) {
	response := &TempoSearchResponse{
		Traces: []TempoTrace{
			{
				TraceID:           "trace-1",
				StartTimeUnixNano: "1739606400000000000",
				SpanSets: []TempoSpanSet{{
					Spans: []TempoSpan{
						{
							SpanID:            "span-1",
							StartTimeUnixNano: "1739606400000000000",
							Attributes: []TempoAttribute{
								{Key: "gen_ai.conversation.id", Value: tempoStringValue("conv-1")},
								{Key: "sigil.conversation.title", Value: tempoStringValue("Old title")},
							},
						},
						{
							SpanID:            "span-2",
							StartTimeUnixNano: "1739606500000000000",
							Attributes: []TempoAttribute{
								{Key: "gen_ai.conversation.id", Value: tempoStringValue("conv-1")},
								{Key: "sigil.conversation.title", Value: tempoStringValue("Latest title")},
							},
						},
					},
				}},
			},
		},
	}

	grouped := groupTempoSearchResponse(response, nil)
	aggregate := grouped.Conversations["conv-1"]
	if aggregate == nil {
		t.Fatalf("expected conv-1 aggregate")
	}
	if aggregate.ConversationTitle != "Latest title" {
		t.Fatalf("expected latest title, got %q", aggregate.ConversationTitle)
	}
}

func TestGroupTempoSearchResponseTracksModelProviders(t *testing.T) {
	response := &TempoSearchResponse{
		Traces: []TempoTrace{
			{
				TraceID:           "trace-1",
				StartTimeUnixNano: "1739606400000000000",
				SpanSets: []TempoSpanSet{{
					Spans: []TempoSpan{
						{
							SpanID: "span-1",
							Attributes: []TempoAttribute{
								{Key: "gen_ai.conversation.id", Value: tempoStringValue("conv-1")},
								{Key: "gen_ai.request.model", Value: tempoStringValue("us.anthropic.claude-haiku-4-5-20251001-v1:0")},
								{Key: "gen_ai.provider.name", Value: tempoStringValue("bedrock")},
							},
						},
						{
							SpanID: "span-2",
							Attributes: []TempoAttribute{
								{Key: "gen_ai.conversation.id", Value: tempoStringValue("conv-1")},
								{Key: "gen_ai.request.model", Value: tempoStringValue("claude-sonnet-4-5")},
								{Key: "gen_ai.provider.name", Value: tempoStringValue("anthropic")},
							},
						},
						{
							SpanID: "span-3",
							Attributes: []TempoAttribute{
								{Key: "gen_ai.conversation.id", Value: tempoStringValue("conv-1")},
								{Key: "gen_ai.request.model", Value: tempoStringValue("model-no-provider")},
							},
						},
					},
				}},
			},
		},
	}

	grouped := groupTempoSearchResponse(response, nil)
	aggregate := grouped.Conversations["conv-1"]
	if aggregate == nil {
		t.Fatalf("expected conv-1 aggregate")
	}
	if len(aggregate.Models) != 3 {
		t.Fatalf("expected 3 models, got %d", len(aggregate.Models))
	}
	if provider, ok := aggregate.ModelProviders["us.anthropic.claude-haiku-4-5-20251001-v1:0"]; !ok || provider != "bedrock" {
		t.Fatalf("expected bedrock provider for haiku model, got %q (present=%v)", provider, ok)
	}
	if provider, ok := aggregate.ModelProviders["claude-sonnet-4-5"]; !ok || provider != "anthropic" {
		t.Fatalf("expected anthropic provider for sonnet model, got %q (present=%v)", provider, ok)
	}
	if _, ok := aggregate.ModelProviders["model-no-provider"]; ok {
		t.Fatalf("expected no provider entry for model without gen_ai.provider.name")
	}
}

func TestTempoHTTPClientSearchAndTagEndpoints(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Header.Get("X-Scope-OrgID") != "tenant-a" {
			http.Error(w, "missing tenant", http.StatusUnauthorized)
			return
		}
		switch req.URL.Path {
		case "/api/search":
			payload := TempoSearchResponse{Traces: []TempoTrace{}}
			_ = json.NewEncoder(w).Encode(payload)
		case "/api/v2/search/tags":
			_ = json.NewEncoder(w).Encode(map[string]any{"tags": []string{"gen_ai.request.model", "gen_ai.agent.name"}})
		case "/api/v2/search/tag/gen_ai.request.model/values":
			_ = json.NewEncoder(w).Encode(map[string]any{"values": []string{"gpt-4o", "gpt-4o-mini"}})
		case "/api/v2/search/tag/resource.k8s.label.app/kubernetes/io/name/values":
			if !strings.Contains(req.RequestURI, "resource.k8s.label.app%2Fkubernetes%2Fio%2Fname") {
				http.Error(w, "tag path must remain escaped", http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"values": []string{"sigil"}})
		default:
			http.NotFound(w, req)
		}
	}))
	defer server.Close()

	client, err := NewTempoHTTPClient(server.URL, nil)
	if err != nil {
		t.Fatalf("new tempo client: %v", err)
	}

	_, err = client.Search(context.Background(), TempoSearchRequest{
		TenantID: "tenant-a",
		Query:    `{ span.gen_ai.operation.name != "" } | select(span.gen_ai.conversation.id)`,
		Limit:    10,
		Start:    time.Now().Add(-time.Hour),
		End:      time.Now(),
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	tags, err := client.SearchTags(context.Background(), "tenant-a", "span", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("search tags: %v", err)
	}
	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(tags))
	}

	values, err := client.SearchTagValues(context.Background(), "tenant-a", "gen_ai.request.model", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("search tag values: %v", err)
	}
	if len(values) != 2 {
		t.Fatalf("expected 2 tag values, got %d", len(values))
	}

	slashValues, err := client.SearchTagValues(context.Background(), "tenant-a", "resource.k8s.label.app/kubernetes/io/name", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("search tag values with slash key: %v", err)
	}
	if len(slashValues) != 1 || slashValues[0] != "sigil" {
		t.Fatalf("unexpected slash tag values: %#v", slashValues)
	}
}

func TestGrafanaTempoHTTPClientSearchAndTagEndpoints(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Header.Get("Authorization") != "Bearer sa-token" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}
		switch req.URL.Path {
		case "/api/datasources/proxy/uid/tempo-ds/api/search":
			payload := TempoSearchResponse{Traces: []TempoTrace{}}
			_ = json.NewEncoder(w).Encode(payload)
		case "/api/datasources/proxy/uid/tempo-ds/api/v2/search/tags":
			_ = json.NewEncoder(w).Encode(map[string]any{"tags": []string{"gen_ai.request.model", "gen_ai.agent.name"}})
		case "/api/datasources/proxy/uid/tempo-ds/api/v2/search/tag/gen_ai.request.model/values":
			_ = json.NewEncoder(w).Encode(map[string]any{"values": []string{"gpt-4o", "gpt-4o-mini"}})
		case "/api/datasources/proxy/uid/tempo-ds/api/v2/search/tag/resource.k8s.label.app/kubernetes/io/name/values":
			if !strings.Contains(req.RequestURI, "resource.k8s.label.app%2Fkubernetes%2Fio%2Fname") {
				http.Error(w, "tag path must remain escaped", http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"values": []string{"sigil"}})
		default:
			http.NotFound(w, req)
		}
	}))
	defer server.Close()

	client, err := NewGrafanaTempoHTTPClient(server.URL, "tempo-ds", "sa-token", nil)
	if err != nil {
		t.Fatalf("new grafana tempo client: %v", err)
	}

	_, err = client.Search(context.Background(), TempoSearchRequest{
		Query: `{ span.gen_ai.operation.name != "" } | select(span.gen_ai.conversation.id)`,
		Limit: 10,
		Start: time.Now().Add(-time.Hour),
		End:   time.Now(),
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}

	tags, err := client.SearchTags(context.Background(), "tenant-a", "span", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("search tags: %v", err)
	}
	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(tags))
	}

	values, err := client.SearchTagValues(context.Background(), "tenant-a", "gen_ai.request.model", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("search tag values: %v", err)
	}
	if len(values) != 2 {
		t.Fatalf("expected 2 tag values, got %d", len(values))
	}

	slashValues, err := client.SearchTagValues(context.Background(), "tenant-a", "resource.k8s.label.app/kubernetes/io/name", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("search tag values with slash key: %v", err)
	}
	if len(slashValues) != 1 || slashValues[0] != "sigil" {
		t.Fatalf("unexpected slash tag values: %#v", slashValues)
	}
}

func tempoStringValue(value string) TempoAttributeValue {
	return TempoAttributeValue{fields: map[string]any{"stringValue": value}}
}

func tempoNumberValue(value float64) TempoAttributeValue {
	return TempoAttributeValue{fields: map[string]any{"doubleValue": value}}
}
