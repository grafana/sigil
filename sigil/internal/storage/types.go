package storage

import "time"

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
	FirstGenerationAt time.Time
	LastGenerationAt  time.Time
	GenerationCount   int
	CreatedAt         time.Time
	UpdatedAt         time.Time
}
