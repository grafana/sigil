package storage

import "time"

const (
	DefaultColdTotalBudget      = 6 * time.Second
	DefaultColdIndexReadTimeout = time.Second
	DefaultColdIndexRetries     = 1
	DefaultColdIndexWorkers     = 4
	DefaultColdIndexMaxInflight = 64
	DefaultIndexCacheTTL        = 10 * time.Minute
	DefaultIndexCacheMaxBytes   = int64(256 * 1024 * 1024)
)

// ConversationReadPlan carries optional hints to bound and optimize cold-store
// fan-out reads for one conversation detail request.
type ConversationReadPlan struct {
	ExpectedGenerationCount int
	From                    time.Time
	To                      time.Time
}

// GenerationReadPlan carries optional hints to bound and optimize cold-store
// generation-id lookups.
type GenerationReadPlan struct {
	ConversationID string
	From           time.Time
	To             time.Time
	At             time.Time
}

type ColdReadConfig struct {
	TotalBudget      time.Duration
	IndexReadTimeout time.Duration
	IndexRetries     int
	IndexWorkers     int
	IndexMaxInflight int
}

type IndexCacheConfig struct {
	Enabled  bool
	TTL      time.Duration
	MaxBytes int64
}
