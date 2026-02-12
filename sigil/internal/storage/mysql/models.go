package mysql

import "time"

type GenerationModel struct {
	ID               uint64     `gorm:"primaryKey;autoIncrement"`
	TenantID         string     `gorm:"size:128;not null;uniqueIndex:ux_generations_tenant_generation,priority:1;index:idx_generations_tenant_conversation_created,priority:1;index:idx_generations_tenant_compacted_created,priority:1"`
	GenerationID     string     `gorm:"size:255;not null;uniqueIndex:ux_generations_tenant_generation,priority:2"`
	ConversationID   *string    `gorm:"size:255;index:idx_generations_tenant_conversation_created,priority:2"`
	CreatedAt        time.Time  `gorm:"type:datetime(6);not null;index:idx_generations_tenant_conversation_created,priority:3;index:idx_generations_tenant_compacted_created,priority:3"`
	Payload          []byte     `gorm:"type:mediumblob;not null"`
	PayloadSizeBytes int        `gorm:"not null"`
	Compacted        bool       `gorm:"not null;default:false;index:idx_generations_tenant_compacted_created,priority:2"`
	CompactedAt      *time.Time `gorm:"type:datetime(6)"`
}

func (GenerationModel) TableName() string {
	return "generations"
}

type ConversationModel struct {
	ID               uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID         string    `gorm:"size:128;not null;uniqueIndex:ux_conversations_tenant_conversation,priority:1;index:idx_conversations_tenant_updated_at,priority:1"`
	ConversationID   string    `gorm:"size:255;not null;uniqueIndex:ux_conversations_tenant_conversation,priority:2"`
	LastGenerationAt time.Time `gorm:"type:datetime(6);not null"`
	GenerationCount  int       `gorm:"not null;default:0"`
	CreatedAt        time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt        time.Time `gorm:"type:datetime(6);not null;autoUpdateTime;index:idx_conversations_tenant_updated_at,priority:2"`
}

func (ConversationModel) TableName() string {
	return "conversations"
}

type CompactionBlockModel struct {
	ID              uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID        string    `gorm:"size:128;not null;uniqueIndex:ux_compaction_blocks_tenant_block,priority:1;index:idx_compaction_blocks_tenant_time,priority:1"`
	BlockID         string    `gorm:"size:255;not null;uniqueIndex:ux_compaction_blocks_tenant_block,priority:2"`
	MinTime         time.Time `gorm:"type:datetime(6);not null;index:idx_compaction_blocks_tenant_time,priority:2"`
	MaxTime         time.Time `gorm:"type:datetime(6);not null;index:idx_compaction_blocks_tenant_time,priority:3"`
	GenerationCount int       `gorm:"not null"`
	SizeBytes       int64     `gorm:"not null"`
	ObjectPath      string    `gorm:"size:1024;not null"`
	IndexPath       string    `gorm:"size:1024;not null"`
	CreatedAt       time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	Deleted         bool      `gorm:"not null;default:false"`
}

func (CompactionBlockModel) TableName() string {
	return "compaction_blocks"
}

type CompactorLeaseModel struct {
	TenantID  string    `gorm:"size:128;primaryKey"`
	OwnerID   string    `gorm:"size:255;not null"`
	LeasedAt  time.Time `gorm:"type:datetime(6);not null"`
	ExpiresAt time.Time `gorm:"type:datetime(6);not null"`
}

func (CompactorLeaseModel) TableName() string {
	return "compactor_leases"
}
