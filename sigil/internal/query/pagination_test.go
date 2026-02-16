package query

import (
	"testing"
	"time"
)

func TestNormalizeConversationSearchPageSize(t *testing.T) {
	if got := normalizeConversationSearchPageSize(0); got != defaultConversationSearchPageSize {
		t.Fatalf("expected default page size, got %d", got)
	}
	if got := normalizeConversationSearchPageSize(999); got != maxConversationSearchPageSize {
		t.Fatalf("expected capped page size, got %d", got)
	}
	if got := normalizeConversationSearchPageSize(25); got != 25 {
		t.Fatalf("expected explicit page size, got %d", got)
	}
}

func TestConversationSearchCursorRoundTrip(t *testing.T) {
	cursor := conversationSearchCursor{
		EndNanos:              time.Date(2026, 2, 15, 10, 0, 0, 0, time.UTC).UnixNano(),
		ReturnedConversations: []string{"conv-2", "conv-1", "conv-1"},
		FilterHash:            "abc123",
	}

	encoded, err := encodeConversationSearchCursor(cursor)
	if err != nil {
		t.Fatalf("encode cursor: %v", err)
	}
	decoded, err := decodeConversationSearchCursor(encoded)
	if err != nil {
		t.Fatalf("decode cursor: %v", err)
	}

	if decoded.EndNanos != cursor.EndNanos {
		t.Fatalf("unexpected end nanos: got=%d want=%d", decoded.EndNanos, cursor.EndNanos)
	}
	if decoded.FilterHash != cursor.FilterHash {
		t.Fatalf("unexpected filter hash: got=%q want=%q", decoded.FilterHash, cursor.FilterHash)
	}
	if len(decoded.ReturnedConversations) != 2 || decoded.ReturnedConversations[0] != "conv-1" || decoded.ReturnedConversations[1] != "conv-2" {
		t.Fatalf("unexpected returned conversations: %#v", decoded.ReturnedConversations)
	}
}

func TestDecodeConversationSearchCursorRejectsInvalidPayload(t *testing.T) {
	if _, err := decodeConversationSearchCursor("%%%invalid%%%"); err == nil {
		t.Fatalf("expected invalid cursor error")
	}
}

func TestBuildConversationSearchFilterHashChangesOnInput(t *testing.T) {
	parsedA, err := ParseFilterExpression(`model = "gpt-4o"`)
	if err != nil {
		t.Fatalf("parse filters a: %v", err)
	}
	parsedB, err := ParseFilterExpression(`model = "gpt-4o-mini"`)
	if err != nil {
		t.Fatalf("parse filters b: %v", err)
	}

	from := time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC)

	hashA := buildConversationSearchFilterHash(parsedA, nil, from, to)
	hashB := buildConversationSearchFilterHash(parsedB, nil, from, to)
	if hashA == hashB {
		t.Fatalf("expected hashes to differ")
	}
}

func TestNormalizeTagDiscoveryRange(t *testing.T) {
	now := time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC)
	start, end := normalizeTagDiscoveryRange(time.Time{}, time.Time{}, now)
	if end != now {
		t.Fatalf("expected end to default to now")
	}
	if start != now.Add(-defaultTagDiscoveryLookbackDuration) {
		t.Fatalf("expected start to default to lookback")
	}
}
