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

type ModelCardModel struct {
	ID                              uint64     `gorm:"primaryKey;autoIncrement"`
	ModelKey                        string     `gorm:"size:255;not null;uniqueIndex:ux_model_cards_model_key,priority:1"`
	Source                          string     `gorm:"size:32;not null;index:idx_model_cards_source_model,priority:1"`
	SourceModelID                   string     `gorm:"size:255;not null;index:idx_model_cards_source_model,priority:2"`
	CanonicalSlug                   *string    `gorm:"size:255"`
	Name                            string     `gorm:"size:255;not null"`
	Provider                        *string    `gorm:"size:128;index:idx_model_cards_provider,priority:1"`
	Description                     *string    `gorm:"type:text"`
	ContextLength                   *int       `gorm:"index:idx_model_cards_context_length,priority:1"`
	Modality                        *string    `gorm:"size:64"`
	InputModalitiesJSON             string     `gorm:"type:json;not null"`
	OutputModalitiesJSON            string     `gorm:"type:json;not null"`
	SupportedParametersJSON         string     `gorm:"type:json;not null"`
	Tokenizer                       *string    `gorm:"size:128"`
	PromptPriceUSDPerToken          *float64   `gorm:"type:decimal(20,12);index:idx_model_cards_prompt_price,priority:1"`
	CompletionPriceUSDPerToken      *float64   `gorm:"type:decimal(20,12);index:idx_model_cards_completion_price,priority:1"`
	RequestPriceUSD                 *float64   `gorm:"type:decimal(20,12)"`
	ImagePriceUSD                   *float64   `gorm:"type:decimal(20,12)"`
	WebSearchPriceUSD               *float64   `gorm:"type:decimal(20,12)"`
	InputCacheReadPriceUSDPerToken  *float64   `gorm:"type:decimal(20,12)"`
	InputCacheWritePriceUSDPerToken *float64   `gorm:"type:decimal(20,12)"`
	IsFree                          bool       `gorm:"not null;default:false;index:idx_model_cards_is_free,priority:1"`
	TopProviderJSON                 string     `gorm:"type:json;not null"`
	ExpiresAt                       *time.Time `gorm:"type:date"`
	FirstSeenAt                     time.Time  `gorm:"type:datetime(6);not null"`
	LastSeenAt                      time.Time  `gorm:"type:datetime(6);not null;index:idx_model_cards_last_seen,priority:1"`
	DeprecatedAt                    *time.Time `gorm:"type:datetime(6)"`
	RawPayloadJSON                  string     `gorm:"type:json;not null"`
	RefreshedAt                     time.Time  `gorm:"type:datetime(6);not null;index:idx_model_cards_refreshed_at,priority:1"`
	CreatedAt                       time.Time  `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt                       time.Time  `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (ModelCardModel) TableName() string {
	return "model_cards"
}

type ModelCardAliasModel struct {
	ID          uint64    `gorm:"primaryKey;autoIncrement"`
	ModelKey    string    `gorm:"size:255;not null;index:idx_model_card_alias_model_key,priority:1"`
	AliasSource string    `gorm:"size:32;not null;uniqueIndex:ux_model_card_alias,priority:1"`
	AliasValue  string    `gorm:"size:255;not null;uniqueIndex:ux_model_card_alias,priority:2"`
	CreatedAt   time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
}

func (ModelCardAliasModel) TableName() string {
	return "model_card_aliases"
}

type ModelCardRefreshRunModel struct {
	ID               uint64    `gorm:"primaryKey;autoIncrement"`
	Source           string    `gorm:"size:32;not null;index:idx_model_card_runs_source_started,priority:1"`
	RunMode          string    `gorm:"size:32;not null"`
	Status           string    `gorm:"size:16;not null;index:idx_model_card_runs_status_started,priority:1"`
	StartedAt        time.Time `gorm:"type:datetime(6);not null;index:idx_model_card_runs_source_started,priority:2;index:idx_model_card_runs_status_started,priority:2"`
	FinishedAt       time.Time `gorm:"type:datetime(6);not null"`
	FetchedCount     int       `gorm:"not null;default:0"`
	UpsertedCount    int       `gorm:"not null;default:0"`
	StaleMarkedCount int       `gorm:"not null;default:0"`
	ErrorSummary     *string   `gorm:"type:text"`
	DetailsJSON      string    `gorm:"type:json;not null"`
}

func (ModelCardRefreshRunModel) TableName() string {
	return "model_card_refresh_runs"
}

type ModelCardRefreshLeaseModel struct {
	ScopeKey  string    `gorm:"size:128;primaryKey"`
	OwnerID   string    `gorm:"size:255;not null"`
	LeasedAt  time.Time `gorm:"type:datetime(6);not null"`
	ExpiresAt time.Time `gorm:"type:datetime(6);not null;index:idx_model_card_refresh_leases_expires_at,priority:1"`
}

func (ModelCardRefreshLeaseModel) TableName() string {
	return "model_card_refresh_leases"
}
