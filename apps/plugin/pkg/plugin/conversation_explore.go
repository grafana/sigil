package plugin

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

const conversationExploreTraceFetchConcurrency = 15
const conversationExploreTraceTimePadding = 30 * time.Minute

type conversationExploreAttributeArray struct {
	Values []conversationExploreAttributeValue `json:"values,omitempty"`
}

type conversationExploreAttributeValue struct {
	StringValue *string                            `json:"stringValue,omitempty"`
	IntValue    *string                            `json:"intValue,omitempty"`
	DoubleValue *float64                           `json:"doubleValue,omitempty"`
	BoolValue   *bool                              `json:"boolValue,omitempty"`
	ArrayValue  *conversationExploreAttributeArray `json:"arrayValue,omitempty"`
}

type conversationExploreSpan struct {
	TraceID            string                                       `json:"traceID"`
	SpanID             string                                       `json:"spanID"`
	ParentSpanID       string                                       `json:"parentSpanID"`
	Name               string                                       `json:"name"`
	Kind               string                                       `json:"kind"`
	ServiceName        string                                       `json:"serviceName"`
	StartTimeUnixNano  string                                       `json:"startTimeUnixNano"`
	EndTimeUnixNano    string                                       `json:"endTimeUnixNano"`
	DurationNano       string                                       `json:"durationNano"`
	Attributes         map[string]conversationExploreAttributeValue `json:"attributes,omitempty"`
	ResourceAttributes map[string]conversationExploreAttributeValue `json:"resourceAttributes,omitempty"`
	Children           []conversationExploreSpan                    `json:"children,omitempty"`
}

type otlpTrace struct {
	ResourceSpans    []otlpResourceSpan `json:"resourceSpans"`
	ResourceSpansAlt []otlpResourceSpan `json:"resource_spans"`
	Batches          []otlpResourceSpan `json:"batches"`
	Trace            *otlpTrace         `json:"trace"`
	Traces           []otlpTrace        `json:"traces"`
}

type otlpResourceSpan struct {
	Resource                    *otlpResource   `json:"resource"`
	ScopeSpans                  []otlpScopeSpan `json:"scopeSpans"`
	ScopeSpansAlt               []otlpScopeSpan `json:"scope_spans"`
	InstrumentationLibrarySpans []otlpScopeSpan `json:"instrumentationLibrarySpans"`
}

type otlpResource struct {
	Attributes []otlpAttribute `json:"attributes"`
}

type otlpScopeSpan struct {
	Spans []otlpSpan `json:"spans"`
}

type otlpSpan struct {
	TraceID              string          `json:"traceId"`
	TraceIDAlt           string          `json:"trace_id"`
	SpanID               string          `json:"spanId"`
	SpanIDAlt            string          `json:"span_id"`
	ParentSpanID         string          `json:"parentSpanId"`
	ParentSpanIDAlt      string          `json:"parent_span_id"`
	Name                 string          `json:"name"`
	Kind                 any             `json:"kind"`
	StartTimeUnixNano    any             `json:"startTimeUnixNano"`
	StartTimeUnixNanoAlt any             `json:"start_time_unix_nano"`
	EndTimeUnixNano      any             `json:"endTimeUnixNano"`
	EndTimeUnixNanoAlt   any             `json:"end_time_unix_nano"`
	Attributes           []otlpAttribute `json:"attributes"`
}

type otlpAttribute struct {
	Key   string        `json:"key"`
	Value otlpAttrValue `json:"value"`
}

type otlpAttrValue struct {
	StringValue *string         `json:"stringValue"`
	IntValue    *string         `json:"intValue"`
	DoubleValue *float64        `json:"doubleValue"`
	BoolValue   *bool           `json:"boolValue"`
	ArrayValue  *otlpArrayValue `json:"arrayValue"`
}

type otlpArrayValue struct {
	Values []otlpAttrValue `json:"values"`
}

type rawConversationExploreSpan struct {
	TraceID            string
	SpanID             string
	ParentSpanID       string
	Name               string
	Kind               string
	ServiceName        string
	StartTimeUnixNano  int64
	EndTimeUnixNano    int64
	DurationNano       int64
	Attributes         map[string]conversationExploreAttributeValue
	ResourceAttributes map[string]conversationExploreAttributeValue
	Children           []*rawConversationExploreSpan
}

type conversationExploreTraceWindow struct {
	Start time.Time
	End   time.Time
}

type conversationExploreTraceWindowSummary struct {
	Min time.Time
	Max time.Time
}

func (a *App) handleConversationExplore(w http.ResponseWriter, req *http.Request, conversationID string) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	detailPayload, err := a.doSigilRequest(
		req,
		http.MethodGet,
		fmt.Sprintf("/api/v1/conversations/%s", url.PathEscape(strings.TrimSpace(conversationID))),
		nil,
		nil,
	)
	if err != nil {
		a.writeSearchError(w, "/query/conversations/"+url.PathEscape(strings.TrimSpace(conversationID))+"/explore", err)
		return
	}

	var detail map[string]any
	if err := json.Unmarshal(detailPayload, &detail); err != nil {
		http.Error(w, fmt.Sprintf("decode conversation detail: %v", err), http.StatusBadGateway)
		return
	}

	conversationWindow := conversationExploreWindowFromStrings(
		stringField(detail, "first_generation_at"),
		stringField(detail, "last_generation_at"),
	)
	generations, traceIDs, generationSpanKeys, traceWindows := extractExploreGenerations(
		detail["generations"],
		conversationWindow,
	)
	_ = generations
	spans := []conversationExploreSpan{}
	if a.hasGrafanaDatasourceProxyTarget(a.tempoDatasourceUID) && len(traceIDs) > 0 {
		spans = a.fetchConversationExploreSpans(req, traceIDs, generationSpanKeys, traceWindows)
	}
	detail["spans"] = spans
	writeJSONResponse(w, http.StatusOK, detail)
}

func extractExploreGenerations(
	raw any,
	conversationWindow conversationExploreTraceWindow,
) ([]map[string]any, []string, map[string]struct{}, map[string]conversationExploreTraceWindow) {
	items, ok := raw.([]any)
	if !ok || len(items) == 0 {
		return nil, nil, map[string]struct{}{}, map[string]conversationExploreTraceWindow{}
	}

	generations := make([]map[string]any, 0, len(items))
	traceIDs := make([]string, 0, len(items))
	seenTraceIDs := make(map[string]struct{}, len(items))
	generationSpanKeys := make(map[string]struct{}, len(items))
	traceWindows := make(map[string]conversationExploreTraceWindowSummary, len(items))
	for _, item := range items {
		generation, ok := item.(map[string]any)
		if !ok {
			continue
		}
		generations = append(generations, generation)

		traceID := stringField(generation, "trace_id")
		spanID := stringField(generation, "span_id")
		normalizedTraceID := normalizeConversationExploreTraceID(traceID)
		normalizedSpanID := normalizeConversationExploreSpanID(spanID)
		if normalizedTraceID != "" && normalizedSpanID != "" {
			generationSpanKeys[normalizedTraceID+":"+normalizedSpanID] = struct{}{}
		}
		if traceID == "" {
			continue
		}
		if _, exists := seenTraceIDs[traceID]; exists {
			if createdAt := generationTimeField(generation); !createdAt.IsZero() {
				summary := traceWindows[traceID]
				traceWindows[traceID] = mergeConversationExploreTraceWindowSummary(summary, createdAt)
			}
			continue
		}
		seenTraceIDs[traceID] = struct{}{}
		traceIDs = append(traceIDs, traceID)
		if createdAt := generationTimeField(generation); !createdAt.IsZero() {
			traceWindows[traceID] = mergeConversationExploreTraceWindowSummary(traceWindows[traceID], createdAt)
		}
	}
	boundedTraceWindows := make(map[string]conversationExploreTraceWindow, len(traceIDs))
	for _, traceID := range traceIDs {
		summary := traceWindows[traceID]
		window := conversationExploreTraceWindowFromSummary(summary)
		window = mergeConversationExploreTraceWindow(window, conversationWindow)
		if !window.Start.IsZero() && !window.End.IsZero() {
			boundedTraceWindows[traceID] = paddedConversationExploreWindow(window.Start, window.End)
		}
	}
	return generations, traceIDs, generationSpanKeys, boundedTraceWindows
}

func stringField(record map[string]any, key string) string {
	value, ok := record[key]
	if !ok {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func normalizeConversationExploreID(value string, expectedHexLength int, expectedByteLength int) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) == expectedHexLength && isHexString(trimmed) {
		return strings.ToLower(trimmed)
	}
	decoded, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		return trimmed
	}
	if len(decoded) != expectedByteLength {
		return trimmed
	}
	return hex.EncodeToString(decoded)
}

func normalizeConversationExploreTraceID(value string) string {
	return normalizeConversationExploreID(value, 32, 16)
}

func normalizeConversationExploreSpanID(value string) string {
	return normalizeConversationExploreID(value, 16, 8)
}

func isHexString(value string) bool {
	for _, r := range value {
		switch {
		case r >= '0' && r <= '9':
		case r >= 'a' && r <= 'f':
		case r >= 'A' && r <= 'F':
		default:
			return false
		}
	}
	return true
}

func generationTimeField(record map[string]any) time.Time {
	if createdAt := parseConversationExploreTimestamp(stringField(record, "created_at")); !createdAt.IsZero() {
		return createdAt
	}
	return parseConversationExploreTimestamp(stringField(record, "started_at"))
}

func parseConversationExploreTimestamp(value string) time.Time {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339Nano, trimmed)
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

func mergeConversationExploreTraceWindowSummary(
	summary conversationExploreTraceWindowSummary,
	at time.Time,
) conversationExploreTraceWindowSummary {
	if summary.Min.IsZero() || at.Before(summary.Min) {
		summary.Min = at
	}
	if summary.Max.IsZero() || at.After(summary.Max) {
		summary.Max = at
	}
	return summary
}

func conversationExploreWindowFromStrings(startText, endText string) conversationExploreTraceWindow {
	start := parseConversationExploreTimestamp(startText)
	end := parseConversationExploreTimestamp(endText)
	if start.IsZero() || end.IsZero() {
		return conversationExploreTraceWindow{}
	}
	return conversationExploreTraceWindow{Start: start, End: end}
}

func conversationExploreTraceWindowFromSummary(summary conversationExploreTraceWindowSummary) conversationExploreTraceWindow {
	if summary.Min.IsZero() || summary.Max.IsZero() {
		return conversationExploreTraceWindow{}
	}
	return conversationExploreTraceWindow{Start: summary.Min, End: summary.Max}
}

func mergeConversationExploreTraceWindow(
	window conversationExploreTraceWindow,
	fallback conversationExploreTraceWindow,
) conversationExploreTraceWindow {
	switch {
	case window.Start.IsZero() || window.End.IsZero():
		return fallback
	case fallback.Start.IsZero() || fallback.End.IsZero():
		return window
	default:
		return conversationExploreTraceWindow{
			Start: minConversationExploreTime(window.Start, fallback.Start),
			End:   maxConversationExploreTime(window.End, fallback.End),
		}
	}
}

func paddedConversationExploreWindow(start, end time.Time) conversationExploreTraceWindow {
	if start.IsZero() || end.IsZero() {
		return conversationExploreTraceWindow{}
	}
	if end.Before(start) {
		start, end = end, start
	}
	return conversationExploreTraceWindow{
		Start: start.Add(-conversationExploreTraceTimePadding),
		End:   end.Add(conversationExploreTraceTimePadding),
	}
}

func minConversationExploreTime(left, right time.Time) time.Time {
	if left.Before(right) {
		return left
	}
	return right
}

func maxConversationExploreTime(left, right time.Time) time.Time {
	if left.After(right) {
		return left
	}
	return right
}

func (window conversationExploreTraceWindow) queryValues() url.Values {
	if window.Start.IsZero() || window.End.IsZero() {
		return nil
	}
	start := window.Start.UTC().Unix()
	end := window.End.UTC().Unix()
	if end <= start {
		end = start + 1
	}
	query := url.Values{}
	query.Set("start", strconv.FormatInt(start, 10))
	query.Set("end", strconv.FormatInt(end, 10))
	return query
}

func (a *App) fetchConversationExploreSpans(
	req *http.Request,
	traceIDs []string,
	generationSpanKeys map[string]struct{},
	traceWindows map[string]conversationExploreTraceWindow,
) []conversationExploreSpan {
	orderedTraceIDs := append([]string(nil), traceIDs...)
	results := make([][]conversationExploreSpan, len(orderedTraceIDs))
	workCh := make(chan int)
	var wg sync.WaitGroup

	workerCount := conversationExploreTraceFetchConcurrency
	if len(orderedTraceIDs) < workerCount {
		workerCount = len(orderedTraceIDs)
	}
	for worker := 0; worker < workerCount; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range workCh {
				traceID := orderedTraceIDs[index]
				spans, err := a.fetchSingleConversationExploreTrace(
					req,
					traceID,
					generationSpanKeys,
					traceWindows[traceID],
				)
				if err != nil {
					backend.Logger.Warn("conversation explore trace fetch failed", "traceID", traceID, "error", err)
					continue
				}
				results[index] = spans
			}
		}()
	}

	for index := range orderedTraceIDs {
		workCh <- index
	}
	close(workCh)
	wg.Wait()

	merged := make([]conversationExploreSpan, 0)
	for _, spans := range results {
		merged = append(merged, spans...)
	}
	sort.Slice(merged, func(i, j int) bool {
		left, _ := strconv.ParseInt(merged[i].StartTimeUnixNano, 10, 64)
		right, _ := strconv.ParseInt(merged[j].StartTimeUnixNano, 10, 64)
		return left < right
	})
	return merged
}

func (a *App) fetchSingleConversationExploreTrace(
	req *http.Request,
	traceID string,
	generationSpanKeys map[string]struct{},
	traceWindow conversationExploreTraceWindow,
) ([]conversationExploreSpan, error) {
	path := fmt.Sprintf("/api/datasources/proxy/uid/%s/api/v2/traces/%s", a.tempoDatasourceUID, url.PathEscape(traceID))
	payload, err := a.doGrafanaRequest(
		req,
		http.MethodGet,
		path,
		traceWindow.queryValues(),
		nil,
	)
	if err != nil && traceWindow.Start != (time.Time{}) && traceWindow.End != (time.Time{}) {
		if upstreamErr := (*upstreamHTTPError)(nil); errors.As(err, &upstreamErr) && upstreamErr.StatusCode == http.StatusNotFound {
			payload, err = a.doGrafanaRequest(req, http.MethodGet, path, nil, nil)
		}
	}
	if err != nil {
		return nil, err
	}
	return buildConversationExploreTrace(traceID, payload, generationSpanKeys)
}

func buildConversationExploreTrace(
	traceID string,
	payload []byte,
	generationSpanKeys map[string]struct{},
) ([]conversationExploreSpan, error) {
	var parsed otlpTrace
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return nil, err
	}

	candidates := collectTraceCandidates(parsed)
	if len(candidates) == 0 {
		return []conversationExploreSpan{}, nil
	}

	rawSpans := make([]*rawConversationExploreSpan, 0)
	for _, candidate := range candidates {
		resourceSpans := candidate.ResourceSpans
		if len(resourceSpans) == 0 {
			resourceSpans = candidate.ResourceSpansAlt
		}
		if len(resourceSpans) == 0 {
			resourceSpans = candidate.Batches
		}
		for _, resourceSpan := range resourceSpans {
			serviceName := ""
			resourceAttributes := make(map[string]conversationExploreAttributeValue)
			if resourceSpan.Resource != nil {
				resourceAttributes = buildExploreAttributeMap(resourceSpan.Resource.Attributes)
				serviceName = firstStringAttribute(resourceAttributes, "service.name")
			}

			scopeSpans := resourceSpan.ScopeSpans
			if len(scopeSpans) == 0 {
				scopeSpans = resourceSpan.ScopeSpansAlt
			}
			if len(scopeSpans) == 0 {
				scopeSpans = resourceSpan.InstrumentationLibrarySpans
			}
			for _, scopeSpan := range scopeSpans {
				for _, span := range scopeSpan.Spans {
					startNs, ok := parseNanoValue(span.StartTimeUnixNano)
					if !ok {
						startNs, ok = parseNanoValue(span.StartTimeUnixNanoAlt)
						if !ok {
							continue
						}
					}
					endNs, ok := parseNanoValue(span.EndTimeUnixNano)
					if !ok {
						endNs, ok = parseNanoValue(span.EndTimeUnixNanoAlt)
					}
					if !ok || endNs < startNs {
						endNs = startNs
					}
					duration := endNs - startNs
					if duration <= 0 {
						duration = 1
					}

					spanTraceID := normalizeConversationExploreTraceID(span.TraceID)
					if spanTraceID == "" {
						spanTraceID = normalizeConversationExploreTraceID(span.TraceIDAlt)
					}
					if spanTraceID == "" {
						spanTraceID = normalizeConversationExploreTraceID(traceID)
					}
					if spanTraceID == "" {
						spanTraceID = traceID
					}

					spanID := normalizeConversationExploreSpanID(span.SpanID)
					if spanID == "" {
						spanID = normalizeConversationExploreSpanID(span.SpanIDAlt)
					}
					if spanID == "" {
						continue
					}

					parentSpanID := normalizeConversationExploreSpanID(span.ParentSpanID)
					if parentSpanID == "" {
						parentSpanID = normalizeConversationExploreSpanID(span.ParentSpanIDAlt)
					}

					name := strings.TrimSpace(span.Name)
					if name == "" {
						name = "(unnamed span)"
					}

					rawSpans = append(rawSpans, &rawConversationExploreSpan{
						TraceID:            spanTraceID,
						SpanID:             spanID,
						ParentSpanID:       parentSpanID,
						Name:               name,
						Kind:               normalizeSpanKind(span.Kind),
						ServiceName:        serviceName,
						StartTimeUnixNano:  startNs,
						EndTimeUnixNano:    endNs,
						DurationNano:       duration,
						Attributes:         buildExploreAttributeMap(span.Attributes),
						ResourceAttributes: resourceAttributes,
					})
				}
			}
		}
	}

	roots := buildConversationExploreTree(rawSpans)
	return compactConversationExploreTree(roots, generationSpanKeys), nil
}

func collectTraceCandidates(root otlpTrace) []otlpTrace {
	candidates := make([]otlpTrace, 0, 1+len(root.Traces))
	if len(root.ResourceSpans) > 0 || len(root.ResourceSpansAlt) > 0 || len(root.Batches) > 0 {
		candidates = append(candidates, root)
	}
	if root.Trace != nil {
		candidates = append(candidates, collectTraceCandidates(*root.Trace)...)
	}
	for _, trace := range root.Traces {
		candidates = append(candidates, collectTraceCandidates(trace)...)
	}
	return candidates
}

func buildConversationExploreTree(rawSpans []*rawConversationExploreSpan) []*rawConversationExploreSpan {
	nodesByKey := make(map[string]*rawConversationExploreSpan, len(rawSpans))
	childrenByParent := make(map[string][]*rawConversationExploreSpan)
	for _, span := range rawSpans {
		nodesByKey[span.TraceID+":"+span.SpanID] = span
		if span.ParentSpanID != "" {
			parentKey := span.TraceID + ":" + span.ParentSpanID
			childrenByParent[parentKey] = append(childrenByParent[parentKey], span)
		}
	}

	for parentKey, children := range childrenByParent {
		parent, ok := nodesByKey[parentKey]
		if !ok {
			continue
		}
		sort.Slice(children, func(i, j int) bool {
			return children[i].StartTimeUnixNano < children[j].StartTimeUnixNano
		})
		parent.Children = children
	}

	roots := make([]*rawConversationExploreSpan, 0)
	for _, span := range rawSpans {
		if span.ParentSpanID == "" {
			roots = append(roots, span)
			continue
		}
		if _, ok := nodesByKey[span.TraceID+":"+span.ParentSpanID]; !ok {
			roots = append(roots, span)
		}
	}
	sort.Slice(roots, func(i, j int) bool {
		return roots[i].StartTimeUnixNano < roots[j].StartTimeUnixNano
	})
	return roots
}

func compactConversationExploreTree(
	nodes []*rawConversationExploreSpan,
	generationSpanKeys map[string]struct{},
) []conversationExploreSpan {
	out := make([]conversationExploreSpan, 0)
	for _, node := range nodes {
		children := compactConversationExploreTree(node.Children, generationSpanKeys)
		if !shouldIncludeConversationExploreSpan(node, generationSpanKeys) {
			out = append(out, children...)
			continue
		}
		out = append(out, conversationExploreSpan{
			TraceID:            node.TraceID,
			SpanID:             node.SpanID,
			ParentSpanID:       node.ParentSpanID,
			Name:               node.Name,
			Kind:               node.Kind,
			ServiceName:        node.ServiceName,
			StartTimeUnixNano:  strconv.FormatInt(node.StartTimeUnixNano, 10),
			EndTimeUnixNano:    strconv.FormatInt(node.EndTimeUnixNano, 10),
			DurationNano:       strconv.FormatInt(node.DurationNano, 10),
			Attributes:         node.Attributes,
			ResourceAttributes: node.ResourceAttributes,
			Children:           children,
		})
	}
	return out
}

func shouldIncludeConversationExploreSpan(
	span *rawConversationExploreSpan,
	generationSpanKeys map[string]struct{},
) bool {
	if span == nil {
		return false
	}
	if _, ok := generationSpanKeys[span.TraceID+":"+span.SpanID]; ok {
		return true
	}
	if firstStringAttribute(span.Attributes, "sigil.generation.id") != "" {
		return true
	}
	if firstStringAttribute(span.Attributes, "sigil.framework.name") != "" {
		return true
	}
	switch firstStringAttribute(span.Attributes, "gen_ai.operation.name") {
	case "generateText", "streamText", "execute_tool", "embeddings":
		return true
	default:
		return firstStringAttribute(span.Attributes, "sigil.sdk.name") != ""
	}
}

func buildExploreAttributeMap(attributes []otlpAttribute) map[string]conversationExploreAttributeValue {
	if len(attributes) == 0 {
		return nil
	}
	out := make(map[string]conversationExploreAttributeValue, len(attributes))
	for _, attribute := range attributes {
		key := strings.TrimSpace(attribute.Key)
		if key == "" {
			continue
		}
		out[key] = convertExploreAttributeValue(attribute.Value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func convertExploreAttributeValue(value otlpAttrValue) conversationExploreAttributeValue {
	out := conversationExploreAttributeValue{
		StringValue: value.StringValue,
		IntValue:    value.IntValue,
		DoubleValue: value.DoubleValue,
		BoolValue:   value.BoolValue,
	}
	if value.ArrayValue != nil && len(value.ArrayValue.Values) > 0 {
		values := make([]conversationExploreAttributeValue, 0, len(value.ArrayValue.Values))
		for _, item := range value.ArrayValue.Values {
			values = append(values, convertExploreAttributeValue(item))
		}
		out.ArrayValue = &conversationExploreAttributeArray{Values: values}
	}
	return out
}

func firstStringAttribute(attributes map[string]conversationExploreAttributeValue, key string) string {
	if attributes == nil {
		return ""
	}
	value, ok := attributes[key]
	if !ok || value.StringValue == nil {
		return ""
	}
	return strings.TrimSpace(*value.StringValue)
}

func parseNanoValue(value any) (int64, bool) {
	switch typed := value.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, false
		}
		parsed, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	case float64:
		return int64(typed), true
	case int64:
		return typed, true
	case int:
		return int64(typed), true
	default:
		return 0, false
	}
}

func normalizeSpanKind(kind any) string {
	switch strings.TrimSpace(fmt.Sprint(kind)) {
	case "1":
		return "INTERNAL"
	case "2":
		return "SERVER"
	case "3":
		return "CLIENT"
	case "4":
		return "PRODUCER"
	case "5":
		return "CONSUMER"
	default:
		return "UNSPECIFIED"
	}
}
