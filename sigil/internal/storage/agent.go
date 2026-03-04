package storage

import (
	"context"
	"time"
)

type AgentHead struct {
	ID                              uint64
	TenantID                        string
	AgentName                       string
	LatestEffectiveVersion          string
	LatestDeclaredVersion           *string
	LatestSeenAt                    time.Time
	FirstSeenAt                     time.Time
	GenerationCount                 int64
	VersionCount                    int
	LatestToolCount                 int
	LatestSystemPromptPrefix        string
	LatestTokenEstimateSystemPrompt int
	LatestTokenEstimateToolsTotal   int
	LatestTokenEstimateTotal        int
}

type AgentHeadCursor struct {
	LatestSeenAt time.Time
	AgentName    string
	ID           uint64
}

type AgentVersion struct {
	TenantID                  string
	AgentName                 string
	EffectiveVersion          string
	DeclaredVersionFirst      *string
	DeclaredVersionLatest     *string
	SystemPrompt              string
	SystemPromptPrefix        string
	ToolsJSON                 string
	ToolCount                 int
	TokenEstimateSystemPrompt int
	TokenEstimateToolsTotal   int
	TokenEstimateTotal        int
	GenerationCount           int64
	FirstSeenAt               time.Time
	LastSeenAt                time.Time
}

type AgentVersionModel struct {
	ModelProvider   string
	ModelName       string
	GenerationCount int64
	FirstSeenAt     time.Time
	LastSeenAt      time.Time
}

type AgentCatalogStore interface {
	ListAgentHeads(ctx context.Context, tenantID string, limit int, cursor *AgentHeadCursor, namePrefix string) ([]AgentHead, *AgentHeadCursor, error)
	GetAgentVersion(ctx context.Context, tenantID, agentName, effectiveVersion string) (*AgentVersion, error)
	GetLatestAgentVersion(ctx context.Context, tenantID, agentName string) (*AgentVersion, error)
	ListAgentVersionModels(ctx context.Context, tenantID, agentName, effectiveVersion string) ([]AgentVersionModel, error)
}
