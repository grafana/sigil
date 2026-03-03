package query

import (
	"time"

	"github.com/grafana/sigil/sigil/pkg/searchcore"
)

const (
	defaultConversationSearchPageSize   = searchcore.DefaultConversationSearchPageSize
	maxConversationSearchPageSize       = searchcore.MaxConversationSearchPageSize
	defaultTempoOverfetchMultiplier     = searchcore.DefaultTempoOverfetchMultiplier
	defaultTempoSearchMaxIterations     = searchcore.DefaultTempoSearchMaxIterations
	defaultTempoSearchSpansPerSpanSet   = searchcore.DefaultTempoSearchSpansPerSpanSet
	defaultTagDiscoveryLookbackDuration = searchcore.DefaultTagDiscoveryLookbackDuration
)

type conversationSearchCursor = searchcore.ConversationSearchCursor

func normalizeConversationSearchPageSize(value int) int {
	return searchcore.NormalizeConversationSearchPageSize(value)
}

func normalizeTagDiscoveryRange(from, to time.Time, now time.Time) (time.Time, time.Time) {
	return searchcore.NormalizeTagDiscoveryRange(from, to, now)
}

func buildConversationSearchFilterHash(parsed ParsedFilters, selectFields []SelectField, from, to time.Time) string {
	return searchcore.BuildConversationSearchFilterHash(parsed, selectFields, from, to)
}

func encodeConversationSearchCursor(cursor conversationSearchCursor) (string, error) {
	return searchcore.EncodeConversationSearchCursor(cursor)
}

func decodeConversationSearchCursor(raw string) (conversationSearchCursor, error) {
	return searchcore.DecodeConversationSearchCursor(raw)
}

func dedupeAndSortStrings(values []string) []string {
	return searchcore.DedupeAndSortStrings(values)
}
