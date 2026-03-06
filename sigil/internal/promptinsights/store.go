package promptinsights

import "context"

// Store persists and retrieves prompt insights for an agent version.
type Store interface {
	UpsertPromptInsights(ctx context.Context, tenantID, agentName, effectiveVersion string, insights PromptInsights) error
	GetPromptInsights(ctx context.Context, tenantID, agentName, effectiveVersion string) (*PromptInsights, error)
}
