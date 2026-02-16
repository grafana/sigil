package query

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
	defaultConversationSearchPageSize   = 20
	maxConversationSearchPageSize       = 50
	defaultTempoOverfetchMultiplier     = 3
	defaultTempoSearchMaxIterations     = 5
	defaultTempoSearchSpansPerSpanSet   = 100
	defaultTagDiscoveryLookbackDuration = 24 * time.Hour
)

type conversationSearchCursor struct {
	// EndNanos is the next Tempo search upper bound (exclusive) for time-window paging.
	EndNanos int64 `json:"end_nanos"`
	// ReturnedConversations prevents duplicate conversation rows across non-deterministic Tempo pages.
	ReturnedConversations []string `json:"returned_conversations,omitempty"`
	// FilterHash invalidates stale cursors when filter/select/time-range inputs change.
	FilterHash string `json:"filter_hash"`
}

func normalizeConversationSearchPageSize(value int) int {
	if value <= 0 {
		return defaultConversationSearchPageSize
	}
	if value > maxConversationSearchPageSize {
		return maxConversationSearchPageSize
	}
	return value
}

func normalizeTagDiscoveryRange(from, to time.Time, now time.Time) (time.Time, time.Time) {
	end := to.UTC()
	if end.IsZero() {
		end = now.UTC()
	}
	start := from.UTC()
	if start.IsZero() {
		start = end.Add(-defaultTagDiscoveryLookbackDuration)
	}
	if !start.Before(end) {
		start = end.Add(-defaultTagDiscoveryLookbackDuration)
	}
	return start, end
}

func buildConversationSearchFilterHash(parsed ParsedFilters, selectFields []SelectField, from, to time.Time) string {
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

func encodeConversationSearchCursor(cursor conversationSearchCursor) (string, error) {
	if cursor.EndNanos <= 0 {
		return "", errors.New("cursor end_nanos must be positive")
	}
	if strings.TrimSpace(cursor.FilterHash) == "" {
		return "", errors.New("cursor filter_hash is required")
	}

	cursor.ReturnedConversations = dedupeAndSortStrings(cursor.ReturnedConversations)
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", fmt.Errorf("marshal cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeConversationSearchCursor(raw string) (conversationSearchCursor, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return conversationSearchCursor{}, nil
	}

	payload, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return conversationSearchCursor{}, fmt.Errorf("decode cursor: %w", err)
	}

	var cursor conversationSearchCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return conversationSearchCursor{}, fmt.Errorf("parse cursor: %w", err)
	}
	if cursor.EndNanos <= 0 {
		return conversationSearchCursor{}, errors.New("cursor end_nanos must be positive")
	}
	if strings.TrimSpace(cursor.FilterHash) == "" {
		return conversationSearchCursor{}, errors.New("cursor filter_hash is required")
	}
	cursor.ReturnedConversations = dedupeAndSortStrings(cursor.ReturnedConversations)
	return cursor, nil
}

func dedupeAndSortStrings(values []string) []string {
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
