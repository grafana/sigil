package storage

import (
	"time"

	"github.com/grafana/sigil/sigil/internal/feedback"
)

type Block struct {
	ID          string
	Generations []GenerationRecord
}

type GenerationRecord struct {
	GenerationID   string
	ConversationID string
	CreatedAt      time.Time
	Payload        []byte
}

type IndexEntry struct {
	GenerationIDHash   uint64
	ConversationIDHash uint64
	Timestamp          time.Time
	Offset             int64
	Length             int64
}

type BlockIndex struct {
	Entries []IndexEntry
}

type BlockMeta struct {
	TenantID        string
	BlockID         string
	MinTime         time.Time
	MaxTime         time.Time
	GenerationCount int
	SizeBytes       int64
	ObjectPath      string
	IndexPath       string
	CreatedAt       time.Time
	Deleted         bool
}

type Conversation struct {
	TenantID          string
	ConversationID    string
	ConversationTitle string
	TitleUpdatedAt    time.Time
	UserID            string
	UserIDUpdatedAt   time.Time
	FirstGenerationAt time.Time
	LastGenerationAt  time.Time
	GenerationCount   int
	Agents            []string
	Models            []string
	ModelProviders    map[string]string
	ErrorCount        int
	InputTokens       int64
	OutputTokens      int64
	CacheReadTokens   int64
	CacheWriteTokens  int64
	ReasoningTokens   int64
	TotalTokens       int64
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type ConversationProjectionPageQuery struct {
	From                   time.Time
	To                     time.Time
	Limit                  int
	ExcludeConversationIDs []string
}

type ConversationProjectionEvalSummary struct {
	TotalScores int
	PassCount   int
	FailCount   int
}

type ConversationProjectionPageItem struct {
	Conversation    Conversation
	RatingSummary   *feedback.ConversationRatingSummary
	AnnotationCount int
	EvalSummary     *ConversationProjectionEvalSummary
}
