package query

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type TempoClient interface {
	Search(ctx context.Context, request TempoSearchRequest) (*TempoSearchResponse, error)
	SearchTags(ctx context.Context, tenantID string, scope string, from, to time.Time) ([]string, error)
	SearchTagValues(ctx context.Context, tenantID string, tag string, from, to time.Time) ([]string, error)
}

type TempoSearchRequest struct {
	TenantID        string
	Query           string
	Limit           int
	Start           time.Time
	End             time.Time
	SpansPerSpanSet int
}

type TempoSearchResponse struct {
	Traces  []TempoTrace   `json:"traces"`
	Metrics map[string]any `json:"metrics,omitempty"`
}

type TempoTrace struct {
	TraceID           string         `json:"traceID"`
	StartTimeUnixNano string         `json:"startTimeUnixNano"`
	SpanSets          []TempoSpanSet `json:"spanSets"`
}

type TempoSpanSet struct {
	Spans []TempoSpan `json:"spans"`
}

type TempoSpan struct {
	SpanID            string           `json:"spanID"`
	StartTimeUnixNano string           `json:"startTimeUnixNano"`
	DurationNanos     string           `json:"durationNanos"`
	Attributes        []TempoAttribute `json:"attributes"`
}

type TempoAttribute struct {
	Key   string              `json:"key"`
	Value TempoAttributeValue `json:"value"`
}

type TempoAttributeValue struct {
	fields map[string]any
}

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

func (v TempoAttributeValue) stringValue() (string, bool) {
	for _, key := range []string{"stringValue", "value"} {
		candidate, ok := v.lookup(key)
		if !ok {
			continue
		}
		if asString, ok := candidate.(string); ok {
			return asString, true
		}
	}
	if numeric, ok := v.floatValue(); ok {
		return strconv.FormatFloat(numeric, 'f', -1, 64), true
	}
	if boolean, ok := v.boolValue(); ok {
		if boolean {
			return "true", true
		}
		return "false", true
	}
	return "", false
}

func (v TempoAttributeValue) floatValue() (float64, bool) {
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

func (v TempoAttributeValue) boolValue() (bool, bool) {
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

type tempoHTTPClient struct {
	baseURL *url.URL
	client  *http.Client
}

type grafanaTempoHTTPClient struct {
	grafanaBaseURL      *url.URL
	datasourceUID       string
	serviceAccountToken string
	client              *http.Client
}

func NewTempoHTTPClient(rawBaseURL string, client *http.Client) (TempoClient, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawBaseURL))
	if err != nil {
		return nil, fmt.Errorf("parse tempo base url: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("tempo base url scheme must be http or https")
	}
	if parsed.Host == "" {
		return nil, errors.New("tempo base url host is required")
	}

	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}

	return &tempoHTTPClient{
		baseURL: parsed,
		client:  client,
	}, nil
}

func NewGrafanaTempoHTTPClient(rawGrafanaURL string, datasourceUID string, serviceAccountToken string, client *http.Client) (TempoClient, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawGrafanaURL))
	if err != nil {
		return nil, fmt.Errorf("parse grafana url: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("grafana url scheme must be http or https")
	}
	if parsed.Host == "" {
		return nil, errors.New("grafana url host is required")
	}
	if strings.TrimSpace(datasourceUID) == "" {
		return nil, errors.New("grafana tempo datasource uid is required")
	}
	if strings.TrimSpace(serviceAccountToken) == "" {
		return nil, errors.New("grafana service account token is required")
	}

	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}

	return &grafanaTempoHTTPClient{
		grafanaBaseURL:      parsed,
		datasourceUID:       strings.TrimSpace(datasourceUID),
		serviceAccountToken: strings.TrimSpace(serviceAccountToken),
		client:              client,
	}, nil
}

func (c *tempoHTTPClient) Search(ctx context.Context, request TempoSearchRequest) (*TempoSearchResponse, error) {
	if strings.TrimSpace(request.TenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(request.Query) == "" {
		return nil, errors.New("tempo query is required")
	}
	if request.Limit <= 0 {
		return nil, errors.New("tempo limit must be positive")
	}
	if request.SpansPerSpanSet <= 0 {
		request.SpansPerSpanSet = defaultTempoSearchSpansPerSpanSet
	}

	query := url.Values{}
	query.Set("q", request.Query)
	query.Set("limit", strconv.Itoa(request.Limit))
	query.Set("start", strconv.FormatInt(request.Start.UTC().Unix(), 10))
	query.Set("end", strconv.FormatInt(request.End.UTC().Unix(), 10))
	query.Set("spss", strconv.Itoa(request.SpansPerSpanSet))

	body, err := c.doTempoRequest(ctx, request.TenantID, http.MethodGet, "/api/search", "", query, nil)
	if err != nil {
		return nil, err
	}

	var response TempoSearchResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode tempo search response: %w", err)
	}
	if response.Traces == nil {
		response.Traces = []TempoTrace{}
	}
	return &response, nil
}

func (c *grafanaTempoHTTPClient) Search(ctx context.Context, request TempoSearchRequest) (*TempoSearchResponse, error) {
	if strings.TrimSpace(request.Query) == "" {
		return nil, errors.New("tempo query is required")
	}
	if request.Limit <= 0 {
		return nil, errors.New("tempo limit must be positive")
	}
	if request.SpansPerSpanSet <= 0 {
		request.SpansPerSpanSet = defaultTempoSearchSpansPerSpanSet
	}

	query := url.Values{}
	query.Set("q", request.Query)
	query.Set("limit", strconv.Itoa(request.Limit))
	query.Set("start", strconv.FormatInt(request.Start.UTC().Unix(), 10))
	query.Set("end", strconv.FormatInt(request.End.UTC().Unix(), 10))
	query.Set("spss", strconv.Itoa(request.SpansPerSpanSet))

	body, err := c.doGrafanaTempoRequest(ctx, http.MethodGet, "/api/search", "", query, nil)
	if err != nil {
		return nil, err
	}

	var response TempoSearchResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode tempo search response: %w", err)
	}
	if response.Traces == nil {
		response.Traces = []TempoTrace{}
	}
	return &response, nil
}

func (c *tempoHTTPClient) SearchTags(ctx context.Context, tenantID string, scope string, from, to time.Time) ([]string, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}

	query := url.Values{}
	if trimmedScope := strings.TrimSpace(scope); trimmedScope != "" {
		query.Set("scope", trimmedScope)
	}
	if !from.IsZero() {
		query.Set("start", strconv.FormatInt(from.UTC().Unix(), 10))
	}
	if !to.IsZero() {
		query.Set("end", strconv.FormatInt(to.UTC().Unix(), 10))
	}

	body, err := c.doTempoRequest(ctx, tenantID, http.MethodGet, "/api/v2/search/tags", "", query, nil)
	if err != nil {
		return nil, err
	}

	values, err := extractStringSlice(body, "tagNames", "tags", "scopes")
	if err != nil {
		return nil, err
	}
	return dedupeAndSortStrings(values), nil
}

func (c *grafanaTempoHTTPClient) SearchTags(ctx context.Context, _ string, scope string, from, to time.Time) ([]string, error) {
	query := url.Values{}
	if trimmedScope := strings.TrimSpace(scope); trimmedScope != "" {
		query.Set("scope", trimmedScope)
	}
	if !from.IsZero() {
		query.Set("start", strconv.FormatInt(from.UTC().Unix(), 10))
	}
	if !to.IsZero() {
		query.Set("end", strconv.FormatInt(to.UTC().Unix(), 10))
	}

	body, err := c.doGrafanaTempoRequest(ctx, http.MethodGet, "/api/v2/search/tags", "", query, nil)
	if err != nil {
		return nil, err
	}

	values, err := extractStringSlice(body, "tagNames", "tags", "scopes")
	if err != nil {
		return nil, err
	}
	return dedupeAndSortStrings(values), nil
}

func (c *tempoHTTPClient) SearchTagValues(ctx context.Context, tenantID string, tag string, from, to time.Time) ([]string, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(tag) == "" {
		return nil, errors.New("tag is required")
	}

	query := url.Values{}
	if !from.IsZero() {
		query.Set("start", strconv.FormatInt(from.UTC().Unix(), 10))
	}
	if !to.IsZero() {
		query.Set("end", strconv.FormatInt(to.UTC().Unix(), 10))
	}

	trimmedTag := strings.TrimSpace(tag)
	tagPath := "/api/v2/search/tag/" + trimmedTag + "/values"
	tagRawPath := "/api/v2/search/tag/" + url.PathEscape(trimmedTag) + "/values"
	body, err := c.doTempoRequest(ctx, tenantID, http.MethodGet, tagPath, tagRawPath, query, nil)
	if err != nil {
		return nil, err
	}

	values, err := extractStringSlice(body, "values", "tagValues")
	if err != nil {
		return nil, err
	}
	return dedupeAndSortStrings(values), nil
}

func (c *grafanaTempoHTTPClient) SearchTagValues(ctx context.Context, _ string, tag string, from, to time.Time) ([]string, error) {
	if strings.TrimSpace(tag) == "" {
		return nil, errors.New("tag is required")
	}

	query := url.Values{}
	if !from.IsZero() {
		query.Set("start", strconv.FormatInt(from.UTC().Unix(), 10))
	}
	if !to.IsZero() {
		query.Set("end", strconv.FormatInt(to.UTC().Unix(), 10))
	}

	trimmedTag := strings.TrimSpace(tag)
	tagPath := "/api/v2/search/tag/" + trimmedTag + "/values"
	tagRawPath := "/api/v2/search/tag/" + url.PathEscape(trimmedTag) + "/values"
	body, err := c.doGrafanaTempoRequest(ctx, http.MethodGet, tagPath, tagRawPath, query, nil)
	if err != nil {
		return nil, err
	}

	values, err := extractStringSlice(body, "values", "tagValues")
	if err != nil {
		return nil, err
	}
	return dedupeAndSortStrings(values), nil
}

func (c *tempoHTTPClient) doTempoRequest(
	ctx context.Context,
	tenantID string,
	method string,
	endpointPath string,
	endpointRawPath string,
	query url.Values,
	body io.Reader,
) ([]byte, error) {
	requestURL := *c.baseURL
	requestURL.Path = joinURLPath(c.baseURL.Path, endpointPath)
	if strings.TrimSpace(endpointRawPath) != "" {
		requestURL.RawPath = joinURLPath(c.baseURL.EscapedPath(), endpointRawPath)
	}
	requestURL.RawQuery = query.Encode()
	requestURL.Fragment = ""

	req, err := http.NewRequestWithContext(ctx, method, requestURL.String(), body)
	if err != nil {
		return nil, fmt.Errorf("build tempo request: %w", err)
	}
	req.Header.Set("X-Scope-OrgID", strings.TrimSpace(tenantID))

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("tempo request failed: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read tempo response body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("tempo request failed: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(payload)))
	}
	return payload, nil
}

func (c *grafanaTempoHTTPClient) doGrafanaTempoRequest(
	ctx context.Context,
	method string,
	tempoPath string,
	tempoRawPath string,
	query url.Values,
	body io.Reader,
) ([]byte, error) {
	basePath := "/api/datasources/proxy/uid/" + c.datasourceUID
	requestURL := *c.grafanaBaseURL
	requestURL.Path = joinURLPath(c.grafanaBaseURL.Path, joinURLPath(basePath, tempoPath))
	if strings.TrimSpace(tempoRawPath) != "" {
		requestURL.RawPath = joinURLPath(c.grafanaBaseURL.EscapedPath(), joinURLPath(basePath, tempoRawPath))
	}
	requestURL.RawQuery = query.Encode()
	requestURL.Fragment = ""

	req, err := http.NewRequestWithContext(ctx, method, requestURL.String(), body)
	if err != nil {
		return nil, fmt.Errorf("build grafana tempo request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.serviceAccountToken)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("grafana tempo request failed: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read grafana tempo response body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("grafana tempo request failed: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(payload)))
	}
	return payload, nil
}

func joinURLPath(prefix, suffix string) string {
	trimmedPrefix := strings.TrimSuffix(strings.TrimSpace(prefix), "/")
	trimmedSuffix := "/" + strings.TrimPrefix(strings.TrimSpace(suffix), "/")
	if trimmedPrefix == "" {
		return trimmedSuffix
	}
	return trimmedPrefix + trimmedSuffix
}

type tempoSelectedAggregation struct {
	DistinctValues map[string]struct{}
	NumericSum     float64
	HasNumeric     bool
}

type tempoConversationAggregate struct {
	ConversationID        string
	GenerationIDs         map[string]struct{}
	TraceIDs              map[string]struct{}
	Models                map[string]struct{}
	ModelProviders        map[string]string
	Agents                map[string]struct{}
	ErrorCount            int
	Selected              map[string]*tempoSelectedAggregation
	LatestTraceStartNanos int64
}

type tempoGroupResult struct {
	Conversations           map[string]*tempoConversationAggregate
	EarliestTraceStartNanos int64
}

func groupTempoSearchResponse(response *TempoSearchResponse, selectFields []SelectField) tempoGroupResult {
	result := tempoGroupResult{
		Conversations: make(map[string]*tempoConversationAggregate),
	}
	if response == nil {
		return result
	}

	for _, trace := range response.Traces {
		traceStartNanos := parseUnixNanos(trace.StartTimeUnixNano)
		if traceStartNanos > 0 {
			if result.EarliestTraceStartNanos == 0 || traceStartNanos < result.EarliestTraceStartNanos {
				result.EarliestTraceStartNanos = traceStartNanos
			}
		}

		for _, spanSet := range trace.SpanSets {
			for _, span := range spanSet.Spans {
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
					aggregate = &tempoConversationAggregate{
						ConversationID: conversationID,
						GenerationIDs:  make(map[string]struct{}),
						TraceIDs:       make(map[string]struct{}),
						Models:         make(map[string]struct{}),
						ModelProviders: make(map[string]string),
						Agents:         make(map[string]struct{}),
						Selected:       make(map[string]*tempoSelectedAggregation),
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
					if _, exists := aggregate.ModelProviders[model]; !exists {
						if provider := firstAttributeString(attributes, "gen_ai.provider.name", "span.gen_ai.provider.name"); provider != "" {
							aggregate.ModelProviders[model] = provider
						}
					}
				}
				if agent := firstAttributeString(attributes, "gen_ai.agent.name", "span.gen_ai.agent.name"); agent != "" {
					aggregate.Agents[agent] = struct{}{}
				}
				if errorType := firstAttributeString(attributes, "error.type", "span.error.type"); errorType != "" {
					aggregate.ErrorCount++
				}

				for _, field := range selectFields {
					selection := getOrCreateTempoSelectedAggregation(aggregate.Selected, field.Key)
					if field.ResolvedKey == "duration" {
						durationNanos := parseUnixNanos(span.DurationNanos)
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
					if numeric, ok := attributeValue.floatValue(); ok {
						selection.NumericSum += numeric
						selection.HasNumeric = true
						continue
					}
					if asString, ok := attributeValue.stringValue(); ok {
						selection.DistinctValues[asString] = struct{}{}
						continue
					}
					if asBool, ok := attributeValue.boolValue(); ok {
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

func getOrCreateTempoSelectedAggregation(target map[string]*tempoSelectedAggregation, key string) *tempoSelectedAggregation {
	item, ok := target[key]
	if ok {
		return item
	}
	item = &tempoSelectedAggregation{DistinctValues: make(map[string]struct{})}
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
			if asString, ok := value.stringValue(); ok {
				return strings.TrimSpace(asString)
			}
		}
	}
	return ""
}

func parseUnixNanos(raw string) int64 {
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

func extractStringSlice(payload []byte, preferredKeys ...string) ([]string, error) {
	var raw any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, fmt.Errorf("decode tempo response: %w", err)
	}

	results := make([]string, 0)
	for _, key := range preferredKeys {
		results = append(results, extractStringsForKey(raw, key)...)
	}
	if len(results) > 0 {
		return dedupeAndSortStrings(results), nil
	}

	results = append(results, extractAllStrings(raw)...)
	return dedupeAndSortStrings(results), nil
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

func sortedKeysFromSet(values map[string]struct{}) []string {
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
