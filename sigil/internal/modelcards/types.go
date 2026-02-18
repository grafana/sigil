package modelcards

import (
	"regexp"
	"time"
)

const (
	SourceOpenRouter   = "openrouter"
	SourceSupplemental = "supplemental"

	BootstrapModeSnapshotFirst = "snapshot-first"
	BootstrapModeDBOnly        = "db-only"

	SourcePathMemoryLive       = "memory_live"
	SourcePathMemoryStale      = "memory_stale"
	SourcePathSnapshotFallback = "snapshot_fallback"
)

type Config struct {
	SyncInterval  time.Duration
	LeaseTTL      time.Duration
	SourceTimeout time.Duration
	StaleSoft     time.Duration
	StaleHard     time.Duration
	BootstrapMode string
	OwnerID       string
}

type Pricing struct {
	PromptUSDPerToken          *float64 `json:"prompt_usd_per_token,omitempty"`
	CompletionUSDPerToken      *float64 `json:"completion_usd_per_token,omitempty"`
	RequestUSD                 *float64 `json:"request_usd,omitempty"`
	ImageUSD                   *float64 `json:"image_usd,omitempty"`
	WebSearchUSD               *float64 `json:"web_search_usd,omitempty"`
	InputCacheReadUSDPerToken  *float64 `json:"input_cache_read_usd_per_token,omitempty"`
	InputCacheWriteUSDPerToken *float64 `json:"input_cache_write_usd_per_token,omitempty"`
}

type TopProvider struct {
	ContextLength       *int  `json:"context_length,omitempty"`
	MaxCompletionTokens *int  `json:"max_completion_tokens,omitempty"`
	IsModerated         *bool `json:"is_moderated,omitempty"`
}

type Card struct {
	ModelKey            string      `json:"model_key"`
	Source              string      `json:"source"`
	SourceModelID       string      `json:"source_model_id"`
	CanonicalSlug       string      `json:"canonical_slug,omitempty"`
	Name                string      `json:"name"`
	Provider            string      `json:"provider,omitempty"`
	Description         string      `json:"description,omitempty"`
	ContextLength       *int        `json:"context_length,omitempty"`
	Modality            string      `json:"modality,omitempty"`
	InputModalities     []string    `json:"input_modalities,omitempty"`
	OutputModalities    []string    `json:"output_modalities,omitempty"`
	SupportedParameters []string    `json:"supported_parameters,omitempty"`
	Tokenizer           string      `json:"tokenizer,omitempty"`
	Pricing             Pricing     `json:"pricing"`
	IsFree              bool        `json:"is_free"`
	TopProvider         TopProvider `json:"top_provider"`
	ExpiresAt           *time.Time  `json:"expires_at,omitempty"`
	FirstSeenAt         time.Time   `json:"first_seen_at"`
	LastSeenAt          time.Time   `json:"last_seen_at"`
	RefreshedAt         time.Time   `json:"refreshed_at"`
	RawPayloadJSON      string      `json:"-"`
}

type ListParams struct {
	Q                             string
	Source                        string
	Provider                      string
	FreeOnly                      *bool
	MinContextLength              *int
	MaxPromptPriceUSDPerToken     *float64
	MaxCompletionPriceUSDPerToken *float64
	Sort                          string
	Order                         string
	Regex                         *regexp.Regexp
	Limit                         int
	Offset                        int
}

type Freshness struct {
	CatalogLastRefreshedAt *time.Time `json:"catalog_last_refreshed_at,omitempty"`
	Stale                  bool       `json:"stale"`
	SoftStale              bool       `json:"soft_stale"`
	HardStale              bool       `json:"hard_stale"`
	SourcePath             string     `json:"source_path"`
}

type ListResult struct {
	Data       []Card    `json:"data"`
	HasMore    bool      `json:"-"`
	NextOffset int       `json:"-"`
	Freshness  Freshness `json:"freshness"`
}

const (
	ResolveStatusResolved   = "resolved"
	ResolveStatusUnresolved = "unresolved"

	ResolveReasonNotFound     = "not_found"
	ResolveReasonAmbiguous    = "ambiguous"
	ResolveReasonInvalidInput = "invalid_input"

	ResolveMatchStrategyExact      = "exact"
	ResolveMatchStrategyNormalized = "normalized"
)

type ResolveInput struct {
	Provider string
	Model    string
}

type ResolvedCard struct {
	ModelKey      string  `json:"model_key"`
	SourceModelID string  `json:"source_model_id"`
	Pricing       Pricing `json:"pricing"`
}

type ResolveResult struct {
	Provider      string        `json:"provider"`
	Model         string        `json:"model"`
	Status        string        `json:"status"`
	MatchStrategy string        `json:"match_strategy,omitempty"`
	Reason        string        `json:"reason,omitempty"`
	Card          *ResolvedCard `json:"card,omitempty"`
}

type SourceStatus struct {
	Source        string     `json:"source"`
	LastSuccessAt *time.Time `json:"last_success_at,omitempty"`
	LastRunStatus string     `json:"last_run_status,omitempty"`
	LastRunMode   string     `json:"last_run_mode,omitempty"`
	Stale         bool       `json:"stale"`
}

type RefreshRun struct {
	Source           string    `json:"source"`
	RunMode          string    `json:"run_mode"`
	Status           string    `json:"status"`
	StartedAt        time.Time `json:"started_at"`
	FinishedAt       time.Time `json:"finished_at"`
	FetchedCount     int       `json:"fetched_count"`
	UpsertedCount    int       `json:"upserted_count"`
	StaleMarkedCount int       `json:"stale_marked_count"`
	ErrorSummary     string    `json:"error_summary,omitempty"`
	DetailsJSON      string    `json:"-"`
}

func (r RefreshRun) Success() bool {
	return r.Status == "success" || r.Status == "partial"
}
