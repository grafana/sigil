package mysql

import "time"

type GenerationModel struct {
	ID               uint64     `gorm:"primaryKey;autoIncrement;index:idx_generations_tenant_compacted_claimed_created,priority:5;index:idx_generations_tenant_compacted_compacted_at_id,priority:4"`
	TenantID         string     `gorm:"size:128;not null;uniqueIndex:ux_generations_tenant_generation,priority:1;index:idx_generations_tenant_conversation_created,priority:1;index:idx_generations_tenant_compacted_claimed_created,priority:1;index:idx_generations_tenant_compacted_compacted_at_id,priority:1"`
	GenerationID     string     `gorm:"size:255;not null;uniqueIndex:ux_generations_tenant_generation,priority:2"`
	ConversationID   *string    `gorm:"size:255;index:idx_generations_tenant_conversation_created,priority:2"`
	CreatedAt        time.Time  `gorm:"type:datetime(6);not null;index:idx_generations_tenant_conversation_created,priority:3;index:idx_generations_tenant_compacted_claimed_created,priority:4"`
	Payload          []byte     `gorm:"type:mediumblob;not null"`
	PayloadSizeBytes int        `gorm:"not null"`
	Compacted        bool       `gorm:"not null;default:false;index:idx_generations_tenant_compacted_claimed_created,priority:2;index:idx_generations_tenant_compacted_compacted_at_id,priority:2"`
	ClaimedBy        *string    `gorm:"size:255;index:idx_generations_tenant_compacted_claimed_created,priority:3"`
	ClaimedAt        *time.Time `gorm:"type:datetime(6)"`
	CompactedAt      *time.Time `gorm:"type:datetime(6);index:idx_generations_tenant_compacted_compacted_at_id,priority:3"`
	Source           string     `gorm:"size:16;not null;default:telemetry"`
}

func (GenerationModel) TableName() string {
	return "generations"
}

type GenerationScoreModel struct {
	ID                   uint64  `gorm:"primaryKey;autoIncrement;index:idx_generation_scores_tenant_generation_time,priority:4;index:idx_generation_scores_tenant_rule_time,priority:4;index:idx_generation_scores_tenant_key_time,priority:3;index:idx_generation_scores_tenant_pass_time,priority:3"`
	TenantID             string  `gorm:"size:128;not null;uniqueIndex:ux_generation_scores_tenant_score,priority:1;index:idx_generation_scores_tenant_generation_time,priority:1;index:idx_generation_scores_tenant_rule_time,priority:1;index:idx_generation_scores_tenant_key_time,priority:1;index:idx_generation_scores_tenant_pass_time,priority:1;index:idx_generation_scores_tenant_conversation_time,priority:1"`
	ScoreID              string  `gorm:"size:128;not null;uniqueIndex:ux_generation_scores_tenant_score,priority:2"`
	GenerationID         string  `gorm:"size:255;not null;index:idx_generation_scores_tenant_generation_time,priority:2"`
	ConversationID       *string `gorm:"size:255;index:idx_generation_scores_tenant_conversation_time,priority:2"`
	TraceID              *string `gorm:"size:64"`
	SpanID               *string `gorm:"size:16"`
	EvaluatorID          string  `gorm:"size:255;not null"`
	EvaluatorVersion     string  `gorm:"size:64;not null"`
	EvaluatorDescription *string `gorm:"type:text"`
	RuleID               *string `gorm:"size:255;index:idx_generation_scores_tenant_rule_time,priority:2"`
	RunID                *string `gorm:"size:255"`
	ScoreKey             string  `gorm:"size:255;not null;index:idx_generation_scores_tenant_key_time,priority:2"`
	ScoreType            string  `gorm:"size:16;not null"`
	ScoreNumber          *float64
	ScoreBool            *bool
	ScoreString          *string   `gorm:"size:255"`
	Unit                 *string   `gorm:"size:64"`
	Passed               *bool     `gorm:"index:idx_generation_scores_tenant_pass_time,priority:2"`
	Explanation          *string   `gorm:"type:text"`
	MetadataJSON         string    `gorm:"type:json;not null"`
	SourceKind           *string   `gorm:"size:64"`
	SourceID             *string   `gorm:"size:255"`
	CreatedAt            time.Time `gorm:"type:datetime(6);not null;index:idx_generation_scores_tenant_generation_time,priority:3;index:idx_generation_scores_tenant_rule_time,priority:3;index:idx_generation_scores_tenant_key_time,priority:4;index:idx_generation_scores_tenant_pass_time,priority:4;index:idx_generation_scores_tenant_conversation_time,priority:3"`
	IngestedAt           time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
}

func (GenerationScoreModel) TableName() string {
	return "generation_scores"
}

type EvalEnqueueEventModel struct {
	ID             uint64     `gorm:"primaryKey;autoIncrement;index:idx_eval_enqueue_events_status_scheduled_id,priority:3"`
	TenantID       string     `gorm:"size:128;not null;uniqueIndex:ux_eval_enqueue_events_tenant_generation,priority:1"`
	GenerationID   string     `gorm:"size:255;not null;uniqueIndex:ux_eval_enqueue_events_tenant_generation,priority:2"`
	ConversationID *string    `gorm:"size:255"`
	Payload        []byte     `gorm:"type:mediumblob;not null"`
	ScheduledAt    time.Time  `gorm:"type:datetime(6);not null;index:idx_eval_enqueue_events_status_scheduled_id,priority:2"`
	Attempts       int        `gorm:"not null;default:0"`
	Status         string     `gorm:"size:16;not null;index:idx_eval_enqueue_events_status_scheduled_id,priority:1;index:idx_eval_enqueue_events_status_claimed_at,priority:1"`
	ClaimedAt      *time.Time `gorm:"type:datetime(6);index:idx_eval_enqueue_events_status_claimed_at,priority:2"`
	LastError      *string    `gorm:"type:text"`
	CreatedAt      time.Time  `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt      time.Time  `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (EvalEnqueueEventModel) TableName() string {
	return "eval_enqueue_events"
}

type EvalWorkItemModel struct {
	ID               uint64     `gorm:"primaryKey;autoIncrement;index:idx_eval_work_items_status_scheduled_id,priority:3"`
	TenantID         string     `gorm:"size:128;not null;uniqueIndex:ux_eval_work_items_tenant_work,priority:1;index:idx_eval_work_items_tenant_status_scheduled,priority:1"`
	WorkID           string     `gorm:"size:128;not null;uniqueIndex:ux_eval_work_items_tenant_work,priority:2"`
	GenerationID     string     `gorm:"size:255;not null"`
	EvaluatorID      string     `gorm:"size:255;not null"`
	EvaluatorVersion string     `gorm:"size:64;not null"`
	RuleID           string     `gorm:"size:255;not null"`
	ScheduledAt      time.Time  `gorm:"type:datetime(6);not null;index:idx_eval_work_items_tenant_status_scheduled,priority:3;index:idx_eval_work_items_status_scheduled_id,priority:2"`
	Attempts         int        `gorm:"not null;default:0"`
	Status           string     `gorm:"size:16;not null;index:idx_eval_work_items_tenant_status_scheduled,priority:2;index:idx_eval_work_items_status_claimed_at,priority:1;index:idx_eval_work_items_status_scheduled_id,priority:1"`
	ClaimedAt        *time.Time `gorm:"type:datetime(6);index:idx_eval_work_items_status_claimed_at,priority:2"`
	LastError        *string    `gorm:"type:text"`
	CreatedAt        time.Time  `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt        time.Time  `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (EvalWorkItemModel) TableName() string {
	return "eval_work_items"
}

type EvalEvaluatorModel struct {
	ID                    uint64     `gorm:"primaryKey;autoIncrement"`
	TenantID              string     `gorm:"size:128;not null;uniqueIndex:ux_eval_evaluators_tenant_id_version,priority:1;index:idx_eval_evaluators_tenant_deleted_updated,priority:1"`
	EvaluatorID           string     `gorm:"size:255;not null;uniqueIndex:ux_eval_evaluators_tenant_id_version,priority:2;index:idx_eval_evaluators_tenant_deleted_updated,priority:2"`
	Version               string     `gorm:"size:64;not null;uniqueIndex:ux_eval_evaluators_tenant_id_version,priority:3"`
	Kind                  string     `gorm:"size:32;not null"`
	Description           *string    `gorm:"type:text"`
	ConfigJSON            string     `gorm:"type:json;not null"`
	OutputKeysJSON        string     `gorm:"type:json;not null"`
	IsPredefined          bool       `gorm:"not null;default:false"`
	SourceTemplateID      *string    `gorm:"size:255"`
	SourceTemplateVersion *string    `gorm:"size:64"`
	DeletedAt             *time.Time `gorm:"type:datetime(6);index:idx_eval_evaluators_tenant_deleted_updated,priority:3"`
	CreatedAt             time.Time  `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt             time.Time  `gorm:"type:datetime(6);not null;autoUpdateTime;index:idx_eval_evaluators_tenant_deleted_updated,priority:4"`
}

func (EvalEvaluatorModel) TableName() string {
	return "eval_evaluators"
}

type EvalRuleModel struct {
	ID               uint64     `gorm:"primaryKey;autoIncrement"`
	TenantID         string     `gorm:"size:128;not null;uniqueIndex:ux_eval_rules_tenant_id,priority:1;index:idx_eval_rules_tenant_enabled_deleted,priority:1"`
	RuleID           string     `gorm:"size:255;not null;uniqueIndex:ux_eval_rules_tenant_id,priority:2"`
	Enabled          bool       `gorm:"not null;default:true;index:idx_eval_rules_tenant_enabled_deleted,priority:2"`
	Selector         string     `gorm:"size:64;not null;default:user_visible_turn"`
	MatchJSON        string     `gorm:"type:json;not null"`
	SampleRate       float64    `gorm:"not null;default:0.01"`
	EvaluatorIDsJSON string     `gorm:"type:json;not null"`
	DeletedAt        *time.Time `gorm:"type:datetime(6);index:idx_eval_rules_tenant_enabled_deleted,priority:3"`
	CreatedAt        time.Time  `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt        time.Time  `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (EvalRuleModel) TableName() string {
	return "eval_rules"
}

type EvalTemplateModel struct {
	ID            uint64     `gorm:"primaryKey;autoIncrement"`
	TenantID      string     `gorm:"size:128;not null;uniqueIndex:ux_eval_templates_tenant_id,priority:1"`
	TemplateID    string     `gorm:"size:255;not null;uniqueIndex:ux_eval_templates_tenant_id,priority:2"`
	Scope         string     `gorm:"size:32;not null;default:tenant"`
	LatestVersion string     `gorm:"size:64;not null"`
	Kind          string     `gorm:"size:32;not null"`
	Description   *string    `gorm:"type:text"`
	DeletedAt     *time.Time `gorm:"type:datetime(6)"`
	CreatedAt     time.Time  `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt     time.Time  `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (EvalTemplateModel) TableName() string { return "eval_templates" }

type EvalTemplateVersionModel struct {
	ID             uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID       string    `gorm:"size:128;not null;uniqueIndex:ux_eval_template_versions_tenant_id_version,priority:1"`
	TemplateID     string    `gorm:"size:255;not null;uniqueIndex:ux_eval_template_versions_tenant_id_version,priority:2"`
	Version        string    `gorm:"size:64;not null;uniqueIndex:ux_eval_template_versions_tenant_id_version,priority:3"`
	ConfigJSON     string    `gorm:"type:json;not null"`
	OutputKeysJSON string    `gorm:"type:json;not null"`
	Changelog      *string   `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
}

func (EvalTemplateVersionModel) TableName() string { return "eval_template_versions" }

type ConversationModel struct {
	ID                uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID          string    `gorm:"size:128;not null;uniqueIndex:ux_conversations_tenant_conversation,priority:1;index:idx_conversations_tenant_updated_at,priority:1"`
	ConversationID    string    `gorm:"size:255;not null;uniqueIndex:ux_conversations_tenant_conversation,priority:2"`
	FirstGenerationAt time.Time `gorm:"type:datetime(6);not null;default:CURRENT_TIMESTAMP(6)"`
	LastGenerationAt  time.Time `gorm:"type:datetime(6);not null"`
	GenerationCount   int       `gorm:"not null;default:0"`
	CreatedAt         time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt         time.Time `gorm:"type:datetime(6);not null;autoUpdateTime;index:idx_conversations_tenant_updated_at,priority:2"`
}

func (ConversationModel) TableName() string {
	return "conversations"
}

type EvalSavedConversationModel struct {
	ID             uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID       string    `gorm:"size:128;not null;uniqueIndex:ux_eval_saved_conversations_tenant_saved,priority:1;uniqueIndex:ux_eval_saved_conversations_tenant_conversation,priority:1;index:idx_eval_saved_conversations_tenant_source_updated,priority:1"`
	SavedID        string    `gorm:"size:128;not null;uniqueIndex:ux_eval_saved_conversations_tenant_saved,priority:2"`
	ConversationID string    `gorm:"size:255;not null;uniqueIndex:ux_eval_saved_conversations_tenant_conversation,priority:2"`
	Name           string    `gorm:"size:255;not null"`
	Source         string    `gorm:"size:16;not null;index:idx_eval_saved_conversations_tenant_source_updated,priority:2"`
	TagsJSON       []byte    `gorm:"type:json;not null"`
	SavedBy        string    `gorm:"size:255;not null"`
	CreatedAt      time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt      time.Time `gorm:"type:datetime(6);not null;autoUpdateTime;index:idx_eval_saved_conversations_tenant_source_updated,priority:3"`
}

func (EvalSavedConversationModel) TableName() string {
	return "eval_saved_conversations"
}

type AgentVersionModel struct {
	ID                        uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID                  string    `gorm:"size:128;not null;uniqueIndex:ux_agent_versions_tenant_name_version,priority:1;index:idx_agent_versions_tenant_name_last_seen,priority:1"`
	AgentName                 string    `gorm:"size:191;not null;default:'';uniqueIndex:ux_agent_versions_tenant_name_version,priority:2;index:idx_agent_versions_tenant_name_last_seen,priority:2"`
	EffectiveVersion          string    `gorm:"size:71;not null;uniqueIndex:ux_agent_versions_tenant_name_version,priority:3"`
	DeclaredVersionFirst      *string   `gorm:"size:255"`
	DeclaredVersionLatest     *string   `gorm:"size:255"`
	SystemPrompt              string    `gorm:"type:mediumtext;not null"`
	SystemPromptPrefix        string    `gorm:"size:160;not null"`
	ToolsJSON                 string    `gorm:"type:json;not null"`
	ToolCount                 int       `gorm:"not null;default:0"`
	TokenEstimateSystemPrompt int       `gorm:"not null;default:0"`
	TokenEstimateToolsTotal   int       `gorm:"not null;default:0"`
	TokenEstimateTotal        int       `gorm:"not null;default:0"`
	GenerationCount           int64     `gorm:"not null;default:0"`
	FirstSeenAt               time.Time `gorm:"type:datetime(6);not null"`
	LastSeenAt                time.Time `gorm:"type:datetime(6);not null;index:idx_agent_versions_tenant_name_last_seen,priority:3"`
	CreatedAt                 time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt                 time.Time `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (AgentVersionModel) TableName() string {
	return "agent_versions"
}

type AgentVersionModelUsageModel struct {
	ID               uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID         string    `gorm:"size:128;not null;uniqueIndex:ux_agent_version_models_tenant_name_version_model,priority:1;index:idx_agent_version_models_tenant_name_version_generation_count,priority:1"`
	AgentName        string    `gorm:"size:191;not null;default:'';uniqueIndex:ux_agent_version_models_tenant_name_version_model,priority:2;index:idx_agent_version_models_tenant_name_version_generation_count,priority:2"`
	EffectiveVersion string    `gorm:"size:71;not null;uniqueIndex:ux_agent_version_models_tenant_name_version_model,priority:3;index:idx_agent_version_models_tenant_name_version_generation_count,priority:3"`
	ModelProvider    string    `gorm:"size:128;not null;uniqueIndex:ux_agent_version_models_tenant_name_version_model,priority:4"`
	ModelName        string    `gorm:"size:191;not null;uniqueIndex:ux_agent_version_models_tenant_name_version_model,priority:5"`
	GenerationCount  int64     `gorm:"not null;default:0;index:idx_agent_version_models_tenant_name_version_generation_count,priority:4"`
	FirstSeenAt      time.Time `gorm:"type:datetime(6);not null"`
	LastSeenAt       time.Time `gorm:"type:datetime(6);not null"`
	CreatedAt        time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt        time.Time `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (AgentVersionModelUsageModel) TableName() string {
	return "agent_version_models"
}

type AgentHeadModel struct {
	ID                              uint64    `gorm:"primaryKey;autoIncrement;index:idx_agent_heads_tenant_latest_seen_name,priority:4"`
	TenantID                        string    `gorm:"size:128;not null;uniqueIndex:ux_agent_heads_tenant_name,priority:1;index:idx_agent_heads_tenant_latest_seen_name,priority:1"`
	AgentName                       string    `gorm:"size:191;not null;default:'';uniqueIndex:ux_agent_heads_tenant_name,priority:2;index:idx_agent_heads_tenant_latest_seen_name,priority:3"`
	LatestEffectiveVersion          string    `gorm:"size:71;not null"`
	LatestDeclaredVersion           *string   `gorm:"size:255"`
	LatestSeenAt                    time.Time `gorm:"type:datetime(6);not null;index:idx_agent_heads_tenant_latest_seen_name,priority:2"`
	FirstSeenAt                     time.Time `gorm:"type:datetime(6);not null"`
	GenerationCount                 int64     `gorm:"not null;default:0"`
	VersionCount                    int       `gorm:"not null;default:0"`
	LatestToolCount                 int       `gorm:"not null;default:0"`
	LatestSystemPromptPrefix        string    `gorm:"size:160;not null"`
	LatestTokenEstimateSystemPrompt int       `gorm:"not null;default:0"`
	LatestTokenEstimateToolsTotal   int       `gorm:"not null;default:0"`
	LatestTokenEstimateTotal        int       `gorm:"not null;default:0"`
	CreatedAt                       time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt                       time.Time `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (AgentHeadModel) TableName() string {
	return "agent_heads"
}

type AgentVersionRatingModel struct {
	ID               uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID         string    `gorm:"size:128;not null;uniqueIndex:ux_agent_version_ratings_tenant_name_version,priority:1;index:idx_agent_version_ratings_tenant_name_rated,priority:1"`
	AgentName        string    `gorm:"size:191;not null;default:'';uniqueIndex:ux_agent_version_ratings_tenant_name_version,priority:2;index:idx_agent_version_ratings_tenant_name_rated,priority:2"`
	EffectiveVersion string    `gorm:"size:71;not null;uniqueIndex:ux_agent_version_ratings_tenant_name_version,priority:3;index:idx_agent_version_ratings_tenant_name_rated,priority:3"`
	Status           string    `gorm:"size:16;not null;default:'completed'"`
	Score            int       `gorm:"not null"`
	Summary          string    `gorm:"type:text;not null"`
	SuggestionsJSON  string    `gorm:"type:json;not null"`
	TokenWarning     *string   `gorm:"type:text"`
	JudgeModel       string    `gorm:"size:255;not null"`
	JudgeLatencyMs   int64     `gorm:"not null;default:0"`
	RatedAt          time.Time `gorm:"type:datetime(6);not null;index:idx_agent_version_ratings_tenant_name_rated,priority:4"`
	CreatedAt        time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt        time.Time `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (AgentVersionRatingModel) TableName() string {
	return "agent_version_ratings"
}

type ConversationRatingModel struct {
	ID             uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID       string    `gorm:"size:128;not null;uniqueIndex:ux_conversation_ratings_tenant_rating,priority:1;index:idx_conversation_ratings_tenant_conv_created,priority:1;index:idx_conversation_ratings_tenant_conv_rating_created,priority:1;index:idx_conversation_ratings_tenant_rating_created,priority:1"`
	RatingID       string    `gorm:"size:128;not null;uniqueIndex:ux_conversation_ratings_tenant_rating,priority:2"`
	ConversationID string    `gorm:"size:255;not null;index:idx_conversation_ratings_tenant_conv_created,priority:2;index:idx_conversation_ratings_tenant_conv_rating_created,priority:2"`
	GenerationID   *string   `gorm:"size:255"`
	Rating         int       `gorm:"not null;index:idx_conversation_ratings_tenant_conv_rating_created,priority:3;index:idx_conversation_ratings_tenant_rating_created,priority:2"`
	Comment        *string   `gorm:"type:text"`
	MetadataJSON   string    `gorm:"type:json;not null"`
	RaterID        *string   `gorm:"size:255"`
	Source         *string   `gorm:"size:64"`
	CreatedAt      time.Time `gorm:"type:datetime(6);not null;index:idx_conversation_ratings_tenant_conv_created,priority:3;index:idx_conversation_ratings_tenant_conv_rating_created,priority:4;index:idx_conversation_ratings_tenant_rating_created,priority:3"`
	IngestedAt     time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
}

func (ConversationRatingModel) TableName() string {
	return "conversation_ratings"
}

type ConversationRatingSummaryModel struct {
	TenantID       string     `gorm:"size:128;primaryKey;index:idx_conversation_rating_summaries_tenant_has_bad,priority:1;index:idx_conversation_rating_summaries_tenant_latest,priority:1"`
	ConversationID string     `gorm:"size:255;primaryKey"`
	TotalCount     int        `gorm:"not null;default:0"`
	GoodCount      int        `gorm:"not null;default:0"`
	BadCount       int        `gorm:"not null;default:0"`
	LatestRating   int        `gorm:"not null;default:0"`
	LatestRatedAt  time.Time  `gorm:"type:datetime(6);not null;index:idx_conversation_rating_summaries_tenant_latest,priority:2"`
	LatestBadAt    *time.Time `gorm:"type:datetime(6);index:idx_conversation_rating_summaries_tenant_has_bad,priority:3"`
	HasBadRating   bool       `gorm:"not null;default:false;index:idx_conversation_rating_summaries_tenant_has_bad,priority:2"`
	UpdatedAt      time.Time  `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (ConversationRatingSummaryModel) TableName() string {
	return "conversation_rating_summaries"
}

type ConversationAnnotationModel struct {
	ID             uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID       string    `gorm:"size:128;not null;uniqueIndex:ux_conversation_annotations_tenant_annotation,priority:1;index:idx_conversation_annotations_tenant_conv_created,priority:1;index:idx_conversation_annotations_tenant_conv_type_created,priority:1"`
	AnnotationID   string    `gorm:"size:128;not null;uniqueIndex:ux_conversation_annotations_tenant_annotation,priority:2"`
	ConversationID string    `gorm:"size:255;not null;index:idx_conversation_annotations_tenant_conv_created,priority:2;index:idx_conversation_annotations_tenant_conv_type_created,priority:2"`
	GenerationID   *string   `gorm:"size:255"`
	AnnotationType string    `gorm:"size:32;not null;index:idx_conversation_annotations_tenant_conv_type_created,priority:3"`
	Body           *string   `gorm:"type:text"`
	TagsJSON       string    `gorm:"type:json;not null"`
	MetadataJSON   string    `gorm:"type:json;not null"`
	OperatorID     string    `gorm:"size:255;not null"`
	OperatorLogin  *string   `gorm:"size:255"`
	OperatorName   *string   `gorm:"size:255"`
	CreatedAt      time.Time `gorm:"type:datetime(6);not null;index:idx_conversation_annotations_tenant_conv_created,priority:3;index:idx_conversation_annotations_tenant_conv_type_created,priority:4"`
	IngestedAt     time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
}

func (ConversationAnnotationModel) TableName() string {
	return "conversation_annotations"
}

type ConversationAnnotationSummaryModel struct {
	TenantID             string    `gorm:"size:128;primaryKey;index:idx_conversation_annotation_summaries_tenant_latest,priority:1"`
	ConversationID       string    `gorm:"size:255;primaryKey"`
	AnnotationCount      int       `gorm:"not null;default:0"`
	LatestAnnotationType *string   `gorm:"size:32"`
	LatestAnnotatedAt    time.Time `gorm:"type:datetime(6);not null;index:idx_conversation_annotation_summaries_tenant_latest,priority:2"`
	UpdatedAt            time.Time `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (ConversationAnnotationSummaryModel) TableName() string {
	return "conversation_annotation_summaries"
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
	ShardID   int       `gorm:"primaryKey"`
	OwnerID   string    `gorm:"size:255;not null"`
	LeasedAt  time.Time `gorm:"type:datetime(6);not null"`
	ExpiresAt time.Time `gorm:"type:datetime(6);not null"`
}

func (CompactorLeaseModel) TableName() string {
	return "compactor_leases"
}

type TenantSettingsModel struct {
	TenantID                string    `gorm:"size:128;primaryKey"`
	PrometheusDatasourceUID string    `gorm:"size:255;not null;default:''"`
	TempoDatasourceUID      string    `gorm:"size:255;not null;default:''"`
	CreatedAt               time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt               time.Time `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (TenantSettingsModel) TableName() string {
	return "tenant_settings"
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
