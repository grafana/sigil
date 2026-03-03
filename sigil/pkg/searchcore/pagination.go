package searchcore

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	// DefaultConversationSearchPageSize is the default page size for search.
	DefaultConversationSearchPageSize = 20
	// MaxConversationSearchPageSize is the max page size accepted by search.
	MaxConversationSearchPageSize = 50
	// DefaultTempoOverfetchMultiplier controls overfetch against Tempo results.
	DefaultTempoOverfetchMultiplier = 3
	// DefaultTempoSearchMaxIterations bounds window paging loops.
	DefaultTempoSearchMaxIterations = 5
	// DefaultTempoSearchSpansPerSpanSet controls Tempo search span set expansion.
	DefaultTempoSearchSpansPerSpanSet = 100
	// DefaultTagDiscoveryLookbackDuration is applied when no explicit range is set.
	DefaultTagDiscoveryLookbackDuration = 24 * time.Hour
)

// ConversationSearchCursor represents stateless pagination state.
type ConversationSearchCursor struct {
	// EndNanos is the next Tempo search upper bound (exclusive) for time-window paging.
	EndNanos int64 `json:"end_nanos"`
	// ReturnedConversations prevents duplicate rows across non-deterministic Tempo pages.
	ReturnedConversations []string `json:"returned_conversations,omitempty"`
	// FilterHash invalidates stale cursors when request inputs change.
	FilterHash string `json:"filter_hash"`
}

// NormalizeConversationSearchPageSize returns the effective page size.
func NormalizeConversationSearchPageSize(value int) int {
	if value <= 0 {
		return DefaultConversationSearchPageSize
	}
	if value > MaxConversationSearchPageSize {
		return MaxConversationSearchPageSize
	}
	return value
}

// NormalizeTagDiscoveryRange normalizes tag discovery ranges for Tempo APIs.
func NormalizeTagDiscoveryRange(from, to time.Time, now time.Time) (time.Time, time.Time) {
	end := to.UTC()
	if end.IsZero() {
		end = now.UTC()
	}
	start := from.UTC()
	if start.IsZero() {
		start = end.Add(-DefaultTagDiscoveryLookbackDuration)
	}
	if !start.Before(end) {
		start = end.Add(-DefaultTagDiscoveryLookbackDuration)
	}
	return start, end
}

// BuildConversationSearchFilterHash creates a stable hash for cursor invalidation.
func BuildConversationSearchFilterHash(parsed ParsedFilters, selectFields []SelectField, from, to time.Time) string {
	hasher := sha256.New()

	_, _ = hasher.Write([]byte(strings.TrimSpace(parsed.Raw)))
	_, _ = hasher.Write([]byte("\n"))
	for _, term := range parsed.Terms {
		_, _ = hasher.Write([]byte(term.RawKey))
		_, _ = hasher.Write([]byte("|"))
		_, _ = hasher.Write([]byte(term.ResolvedKey))
		_, _ = hasher.Write([]byte("|"))
		_, _ = hasher.Write([]byte(term.Route))
		_, _ = hasher.Write([]byte("|"))
		_, _ = hasher.Write([]byte(term.Operator))
		_, _ = hasher.Write([]byte("|"))
		_, _ = hasher.Write([]byte(term.Value))
		_, _ = hasher.Write([]byte("\n"))
	}

	selectCopy := make([]string, 0, len(selectFields))
	for _, field := range selectFields {
		selectCopy = append(selectCopy, field.ResolvedKey)
	}
	sort.Strings(selectCopy)
	for _, field := range selectCopy {
		_, _ = hasher.Write([]byte(field))
		_, _ = hasher.Write([]byte("\n"))
	}

	_, _ = hasher.Write([]byte(from.UTC().Format(time.RFC3339Nano)))
	_, _ = hasher.Write([]byte("\n"))
	_, _ = hasher.Write([]byte(to.UTC().Format(time.RFC3339Nano)))

	return hex.EncodeToString(hasher.Sum(nil))
}

// EncodeConversationSearchCursor serializes cursor state.
func EncodeConversationSearchCursor(cursor ConversationSearchCursor) (string, error) {
	if cursor.EndNanos <= 0 {
		return "", errors.New("cursor end_nanos must be positive")
	}
	if strings.TrimSpace(cursor.FilterHash) == "" {
		return "", errors.New("cursor filter_hash is required")
	}

	cursor.ReturnedConversations = DedupeAndSortStrings(cursor.ReturnedConversations)
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", fmt.Errorf("marshal cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

// DecodeConversationSearchCursor parses cursor state.
func DecodeConversationSearchCursor(raw string) (ConversationSearchCursor, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ConversationSearchCursor{}, nil
	}

	payload, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return ConversationSearchCursor{}, fmt.Errorf("decode cursor: %w", err)
	}

	var cursor ConversationSearchCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return ConversationSearchCursor{}, fmt.Errorf("parse cursor: %w", err)
	}
	if cursor.EndNanos <= 0 {
		return ConversationSearchCursor{}, errors.New("cursor end_nanos must be positive")
	}
	if strings.TrimSpace(cursor.FilterHash) == "" {
		return ConversationSearchCursor{}, errors.New("cursor filter_hash is required")
	}
	cursor.ReturnedConversations = DedupeAndSortStrings(cursor.ReturnedConversations)
	return cursor, nil
}

// DedupeAndSortStrings trims, de-duplicates, and sorts string values.
func DedupeAndSortStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
