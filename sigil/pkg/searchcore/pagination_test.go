package searchcore

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestNormalizeConversationSearchPageSize(t *testing.T) {
	testCases := []struct {
		input    int
		expected int
	}{
		{input: -1, expected: DefaultConversationSearchPageSize},
		{input: 0, expected: DefaultConversationSearchPageSize},
		{input: 1, expected: 1},
		{input: MaxConversationSearchPageSize, expected: MaxConversationSearchPageSize},
		{input: MaxConversationSearchPageSize + 100, expected: MaxConversationSearchPageSize},
	}
	for _, tc := range testCases {
		if got := NormalizeConversationSearchPageSize(tc.input); got != tc.expected {
			t.Fatalf("NormalizeConversationSearchPageSize(%d)=%d, expected %d", tc.input, got, tc.expected)
		}
	}
}

func TestNormalizeTagDiscoveryRange(t *testing.T) {
	now := time.Date(2026, 3, 3, 10, 0, 0, 0, time.UTC)

	start, end := NormalizeTagDiscoveryRange(time.Time{}, time.Time{}, now)
	if !end.Equal(now) {
		t.Fatalf("expected end=%s, got %s", now, end)
	}
	if !start.Equal(now.Add(-DefaultTagDiscoveryLookbackDuration)) {
		t.Fatalf("expected default lookback start, got %s", start)
	}

	validFrom := now.Add(-2 * time.Hour)
	validTo := now.Add(-time.Hour)
	start, end = NormalizeTagDiscoveryRange(validFrom, validTo, now)
	if !start.Equal(validFrom) || !end.Equal(validTo) {
		t.Fatalf("unexpected normalized range start=%s end=%s", start, end)
	}

	start, end = NormalizeTagDiscoveryRange(now, now.Add(-time.Hour), now)
	if !start.Equal(end.Add(-DefaultTagDiscoveryLookbackDuration)) {
		t.Fatalf("expected fallback lookback start when from >= end")
	}
}

func TestBuildConversationSearchFilterHash(t *testing.T) {
	parsed, err := ParseFilterExpression(`model = "gpt-4o"`)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	from := time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 2, 16, 0, 0, 0, 0, time.UTC)

	hashA := BuildConversationSearchFilterHash(parsed, []SelectField{
		{Key: "a", ResolvedKey: "span.a"},
		{Key: "b", ResolvedKey: "span.b"},
	}, from, to)
	hashB := BuildConversationSearchFilterHash(parsed, []SelectField{
		{Key: "b", ResolvedKey: "span.b"},
		{Key: "a", ResolvedKey: "span.a"},
	}, from, to)
	if hashA != hashB {
		t.Fatalf("expected select order-independent hash, got %q vs %q", hashA, hashB)
	}

	hashC := BuildConversationSearchFilterHash(parsed, []SelectField{
		{Key: "a", ResolvedKey: "span.a"},
		{Key: "b", ResolvedKey: "span.b"},
	}, from, to.Add(time.Second))
	if hashA == hashC {
		t.Fatalf("expected hash to change when time range changes")
	}
}

func TestEncodeDecodeConversationSearchCursor(t *testing.T) {
	cursor := ConversationSearchCursor{
		EndNanos:              123456789,
		ReturnedConversations: []string{"conv-b", "conv-a", "conv-b", " ", ""},
		FilterHash:            "hash-1",
	}
	encoded, err := EncodeConversationSearchCursor(cursor)
	if err != nil {
		t.Fatalf("encode cursor: %v", err)
	}

	decoded, err := DecodeConversationSearchCursor(encoded)
	if err != nil {
		t.Fatalf("decode cursor: %v", err)
	}
	if decoded.EndNanos != cursor.EndNanos {
		t.Fatalf("unexpected end nanos: %d", decoded.EndNanos)
	}
	if decoded.FilterHash != cursor.FilterHash {
		t.Fatalf("unexpected filter hash: %q", decoded.FilterHash)
	}
	expectedReturned := []string{"conv-a", "conv-b"}
	if len(decoded.ReturnedConversations) != len(expectedReturned) {
		t.Fatalf("unexpected returned conversations length: %d", len(decoded.ReturnedConversations))
	}
	for idx, expected := range expectedReturned {
		if decoded.ReturnedConversations[idx] != expected {
			t.Fatalf("unexpected returned conversation at %d: got %q expected %q", idx, decoded.ReturnedConversations[idx], expected)
		}
	}
}

func TestEncodeDecodeConversationSearchCursorErrors(t *testing.T) {
	_, err := EncodeConversationSearchCursor(ConversationSearchCursor{EndNanos: 0, FilterHash: "hash"})
	if err == nil || !strings.Contains(err.Error(), "end_nanos") {
		t.Fatalf("expected end_nanos error, got %v", err)
	}

	_, err = EncodeConversationSearchCursor(ConversationSearchCursor{EndNanos: 1, FilterHash: ""})
	if err == nil || !strings.Contains(err.Error(), "filter_hash") {
		t.Fatalf("expected filter_hash error, got %v", err)
	}

	_, err = DecodeConversationSearchCursor("%%%")
	if err == nil {
		t.Fatalf("expected base64 decode error")
	}

	rawMissingFields := base64.RawURLEncoding.EncodeToString([]byte(`{}`))
	_, err = DecodeConversationSearchCursor(rawMissingFields)
	if err == nil || !strings.Contains(err.Error(), "end_nanos") {
		t.Fatalf("expected end_nanos validation error, got %v", err)
	}
}

func TestDedupeAndSortStrings(t *testing.T) {
	out := DedupeAndSortStrings([]string{"b", "a", "b", " ", "", "c"})
	expected := []string{"a", "b", "c"}
	if len(out) != len(expected) {
		t.Fatalf("unexpected length %d", len(out))
	}
	for idx, expectedValue := range expected {
		if out[idx] != expectedValue {
			t.Fatalf("unexpected value at %d: got %q expected %q", idx, out[idx], expectedValue)
		}
	}
	if got := DedupeAndSortStrings(nil); got != nil {
		t.Fatalf("expected nil for nil input, got %#v", got)
	}
}
