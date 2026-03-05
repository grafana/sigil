package agentrating

import "context"

// LatestStore persists and retrieves the latest rating for an agent version.
type LatestStore interface {
	UpsertAgentVersionRating(ctx context.Context, tenantID, agentName, effectiveVersion string, rating Rating) error
	GetAgentVersionRating(ctx context.Context, tenantID, agentName, effectiveVersion string) (*Rating, error)
}
