package query

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/storage"
	"go.opentelemetry.io/otel/attribute"
)

const (
	defaultAgentListPageSize = 50
	maxAgentListPageSize     = 200
)

var effectiveVersionPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

type AgentTokenEstimate struct {
	SystemPrompt int `json:"system_prompt"`
	ToolsTotal   int `json:"tools_total"`
	Total        int `json:"total"`
}

type AgentListItem struct {
	AgentName              string             `json:"agent_name"`
	LatestEffectiveVersion string             `json:"latest_effective_version"`
	LatestDeclaredVersion  *string            `json:"latest_declared_version,omitempty"`
	FirstSeenAt            time.Time          `json:"first_seen_at"`
	LatestSeenAt           time.Time          `json:"latest_seen_at"`
	GenerationCount        int64              `json:"generation_count"`
	VersionCount           int                `json:"version_count"`
	ToolCount              int                `json:"tool_count"`
	SystemPromptPrefix     string             `json:"system_prompt_prefix"`
	TokenEstimate          AgentTokenEstimate `json:"token_estimate"`
}

type AgentTool struct {
	Name            string `json:"name"`
	Description     string `json:"description"`
	Type            string `json:"type"`
	InputSchemaJSON string `json:"input_schema_json"`
	TokenEstimate   int    `json:"token_estimate"`
}

type AgentModelUsage struct {
	Provider        string    `json:"provider"`
	Name            string    `json:"name"`
	GenerationCount int64     `json:"generation_count"`
	FirstSeenAt     time.Time `json:"first_seen_at"`
	LastSeenAt      time.Time `json:"last_seen_at"`
}

type AgentDetail struct {
	AgentName             string             `json:"agent_name"`
	EffectiveVersion      string             `json:"effective_version"`
	DeclaredVersionFirst  *string            `json:"declared_version_first,omitempty"`
	DeclaredVersionLatest *string            `json:"declared_version_latest,omitempty"`
	FirstSeenAt           time.Time          `json:"first_seen_at"`
	LastSeenAt            time.Time          `json:"last_seen_at"`
	GenerationCount       int64              `json:"generation_count"`
	SystemPrompt          string             `json:"system_prompt"`
	SystemPromptPrefix    string             `json:"system_prompt_prefix"`
	ToolCount             int                `json:"tool_count"`
	TokenEstimate         AgentTokenEstimate `json:"token_estimate"`
	Tools                 []AgentTool        `json:"tools"`
	Models                []AgentModelUsage  `json:"models"`
}

type AgentVersionListItem struct {
	EffectiveVersion      string             `json:"effective_version"`
	DeclaredVersionFirst  *string            `json:"declared_version_first,omitempty"`
	DeclaredVersionLatest *string            `json:"declared_version_latest,omitempty"`
	FirstSeenAt           time.Time          `json:"first_seen_at"`
	LastSeenAt            time.Time          `json:"last_seen_at"`
	GenerationCount       int64              `json:"generation_count"`
	ToolCount             int                `json:"tool_count"`
	SystemPromptPrefix    string             `json:"system_prompt_prefix"`
	TokenEstimate         AgentTokenEstimate `json:"token_estimate"`
}

type agentListCursor struct {
	LatestSeenNanos int64  `json:"latest_seen_nanos"`
	AgentName       string `json:"agent_name"`
	HeadID          uint64 `json:"head_id"`
	FilterHash      string `json:"filter_hash"`
}

type agentVersionListCursor struct {
	LastSeenNanos int64  `json:"last_seen_nanos"`
	VersionID     uint64 `json:"version_id"`
	FilterHash    string `json:"filter_hash"`
}

func (s *Service) ListAgentsForTenant(ctx context.Context, tenantID string, limit int, cursor, namePrefix string) ([]AgentListItem, string, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.list_agents")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedPrefix := strings.TrimSpace(namePrefix)
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return nil, "", err
	}
	if s.agentCatalogStore == nil {
		err := fmt.Errorf("agent catalog store is not configured")
		recordQuerySpanError(span, err)
		return nil, "", err
	}
	pageSize := normalizeAgentListPageSize(limit)
	filterHash := buildAgentListFilterHash(trimmedPrefix)
	cursorState, err := decodeAgentListCursor(cursor)
	if err != nil {
		validationErr := NewValidationError("invalid cursor")
		recordQuerySpanError(span, validationErr)
		return nil, "", validationErr
	}
	if strings.TrimSpace(cursor) != "" && cursorState.FilterHash != filterHash {
		validationErr := NewValidationError("cursor no longer matches current filters")
		recordQuerySpanError(span, validationErr)
		return nil, "", validationErr
	}

	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.Int("sigil.query.limit", pageSize),
		attribute.String("sigil.query.agent_name_prefix", trimmedPrefix),
		attribute.Bool("sigil.query.cursor_provided", strings.TrimSpace(cursor) != ""),
	)

	var storeCursor *storage.AgentHeadCursor
	if cursorState.LatestSeenNanos > 0 {
		storeCursor = &storage.AgentHeadCursor{
			LatestSeenAt: time.Unix(0, cursorState.LatestSeenNanos).UTC(),
			AgentName:    cursorState.AgentName,
			ID:           cursorState.HeadID,
		}
	}

	heads, nextStoreCursor, err := s.agentCatalogStore.ListAgentHeads(ctx, trimmedTenantID, pageSize, storeCursor, trimmedPrefix)
	if err != nil {
		recordQuerySpanError(span, err)
		return nil, "", err
	}

	items := make([]AgentListItem, 0, len(heads))
	for _, head := range heads {
		items = append(items, AgentListItem{
			AgentName:              head.AgentName,
			LatestEffectiveVersion: head.LatestEffectiveVersion,
			LatestDeclaredVersion:  head.LatestDeclaredVersion,
			FirstSeenAt:            head.FirstSeenAt.UTC(),
			LatestSeenAt:           head.LatestSeenAt.UTC(),
			GenerationCount:        head.GenerationCount,
			VersionCount:           head.VersionCount,
			ToolCount:              head.LatestToolCount,
			SystemPromptPrefix:     head.LatestSystemPromptPrefix,
			TokenEstimate: AgentTokenEstimate{
				SystemPrompt: head.LatestTokenEstimateSystemPrompt,
				ToolsTotal:   head.LatestTokenEstimateToolsTotal,
				Total:        head.LatestTokenEstimateTotal,
			},
		})
	}

	nextCursor := ""
	if nextStoreCursor != nil {
		encoded, err := encodeAgentListCursor(agentListCursor{
			LatestSeenNanos: nextStoreCursor.LatestSeenAt.UTC().UnixNano(),
			AgentName:       nextStoreCursor.AgentName,
			HeadID:          nextStoreCursor.ID,
			FilterHash:      filterHash,
		})
		if err != nil {
			recordQuerySpanError(span, err)
			return nil, "", err
		}
		nextCursor = encoded
	}
	span.SetAttributes(
		attribute.Int("sigil.query.result_count", len(items)),
		attribute.Bool("sigil.query.next_cursor_present", nextCursor != ""),
	)

	return items, nextCursor, nil
}

func (s *Service) GetAgentDetailForTenant(ctx context.Context, tenantID, agentName, effectiveVersion string) (AgentDetail, bool, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.get_agent_detail")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedAgentName := strings.TrimSpace(agentName)
	trimmedVersion := strings.TrimSpace(effectiveVersion)
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return AgentDetail{}, false, err
	}
	if s.agentCatalogStore == nil {
		err := fmt.Errorf("agent catalog store is not configured")
		recordQuerySpanError(span, err)
		return AgentDetail{}, false, err
	}
	if trimmedVersion != "" && !effectiveVersionPattern.MatchString(trimmedVersion) {
		err := NewValidationError("invalid version")
		recordQuerySpanError(span, err)
		return AgentDetail{}, false, err
	}
	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.String("sigil.agent.name", trimmedAgentName),
		attribute.String("sigil.agent.effective_version", trimmedVersion),
	)

	var (
		versionRow *storage.AgentVersion
		err        error
	)
	if trimmedVersion == "" {
		versionRow, err = s.agentCatalogStore.GetLatestAgentVersion(ctx, trimmedTenantID, trimmedAgentName)
	} else {
		versionRow, err = s.agentCatalogStore.GetAgentVersion(ctx, trimmedTenantID, trimmedAgentName, trimmedVersion)
	}
	if err != nil {
		recordQuerySpanError(span, err)
		return AgentDetail{}, false, err
	}
	if versionRow == nil {
		span.SetAttributes(attribute.Bool("sigil.query.found", false))
		return AgentDetail{}, false, nil
	}

	modelRows, err := s.agentCatalogStore.ListAgentVersionModels(ctx, trimmedTenantID, trimmedAgentName, versionRow.EffectiveVersion)
	if err != nil {
		recordQuerySpanError(span, err)
		return AgentDetail{}, false, err
	}
	sort.Slice(modelRows, func(i, j int) bool {
		if modelRows[i].GenerationCount == modelRows[j].GenerationCount {
			if modelRows[i].ModelProvider == modelRows[j].ModelProvider {
				return modelRows[i].ModelName < modelRows[j].ModelName
			}
			return modelRows[i].ModelProvider < modelRows[j].ModelProvider
		}
		return modelRows[i].GenerationCount > modelRows[j].GenerationCount
	})
	models := make([]AgentModelUsage, 0, len(modelRows))
	for _, model := range modelRows {
		models = append(models, AgentModelUsage{
			Provider:        model.ModelProvider,
			Name:            model.ModelName,
			GenerationCount: model.GenerationCount,
			FirstSeenAt:     model.FirstSeenAt.UTC(),
			LastSeenAt:      model.LastSeenAt.UTC(),
		})
	}

	var outTools []AgentTool
	if strings.TrimSpace(versionRow.ToolsJSON) != "" {
		if err := json.Unmarshal([]byte(versionRow.ToolsJSON), &outTools); err != nil {
			parseErr := fmt.Errorf("decode stored tools json: %w", err)
			recordQuerySpanError(span, parseErr)
			return AgentDetail{}, false, parseErr
		}
	}
	if outTools == nil {
		outTools = []AgentTool{}
	}

	detail := AgentDetail{
		AgentName:             versionRow.AgentName,
		EffectiveVersion:      versionRow.EffectiveVersion,
		DeclaredVersionFirst:  versionRow.DeclaredVersionFirst,
		DeclaredVersionLatest: versionRow.DeclaredVersionLatest,
		FirstSeenAt:           versionRow.FirstSeenAt.UTC(),
		LastSeenAt:            versionRow.LastSeenAt.UTC(),
		GenerationCount:       versionRow.GenerationCount,
		SystemPrompt:          versionRow.SystemPrompt,
		SystemPromptPrefix:    versionRow.SystemPromptPrefix,
		ToolCount:             versionRow.ToolCount,
		TokenEstimate: AgentTokenEstimate{
			SystemPrompt: versionRow.TokenEstimateSystemPrompt,
			ToolsTotal:   versionRow.TokenEstimateToolsTotal,
			Total:        versionRow.TokenEstimateTotal,
		},
		Tools:  outTools,
		Models: models,
	}
	span.SetAttributes(
		attribute.Bool("sigil.query.found", true),
		attribute.Int("sigil.query.tool_count", len(outTools)),
		attribute.Int("sigil.query.model_count", len(models)),
	)
	return detail, true, nil
}

func (s *Service) ListAgentVersionsForTenant(ctx context.Context, tenantID, agentName string, limit int, cursor string) ([]AgentVersionListItem, string, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.list_agent_versions")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedAgentName := strings.TrimSpace(agentName)
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return nil, "", err
	}
	if s.agentCatalogStore == nil {
		err := fmt.Errorf("agent catalog store is not configured")
		recordQuerySpanError(span, err)
		return nil, "", err
	}

	pageSize := normalizeAgentListPageSize(limit)
	filterHash := buildAgentVersionsFilterHash(trimmedAgentName)
	cursorState, err := decodeAgentVersionListCursor(cursor)
	if err != nil {
		validationErr := NewValidationError("invalid cursor")
		recordQuerySpanError(span, validationErr)
		return nil, "", validationErr
	}
	if strings.TrimSpace(cursor) != "" && cursorState.FilterHash != filterHash {
		validationErr := NewValidationError("cursor no longer matches current filters")
		recordQuerySpanError(span, validationErr)
		return nil, "", validationErr
	}

	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.String("sigil.agent.name", trimmedAgentName),
		attribute.Int("sigil.query.limit", pageSize),
		attribute.Bool("sigil.query.cursor_provided", strings.TrimSpace(cursor) != ""),
	)

	var storeCursor *storage.AgentVersionCursor
	if cursorState.LastSeenNanos > 0 {
		storeCursor = &storage.AgentVersionCursor{
			LastSeenAt: time.Unix(0, cursorState.LastSeenNanos).UTC(),
			ID:         cursorState.VersionID,
		}
	}

	versions, nextStoreCursor, err := s.agentCatalogStore.ListAgentVersions(ctx, trimmedTenantID, trimmedAgentName, pageSize, storeCursor)
	if err != nil {
		recordQuerySpanError(span, err)
		return nil, "", err
	}

	items := make([]AgentVersionListItem, 0, len(versions))
	for _, version := range versions {
		items = append(items, AgentVersionListItem{
			EffectiveVersion:      version.EffectiveVersion,
			DeclaredVersionFirst:  version.DeclaredVersionFirst,
			DeclaredVersionLatest: version.DeclaredVersionLatest,
			FirstSeenAt:           version.FirstSeenAt.UTC(),
			LastSeenAt:            version.LastSeenAt.UTC(),
			GenerationCount:       version.GenerationCount,
			ToolCount:             version.ToolCount,
			SystemPromptPrefix:    version.SystemPromptPrefix,
			TokenEstimate: AgentTokenEstimate{
				SystemPrompt: version.TokenEstimateSystemPrompt,
				ToolsTotal:   version.TokenEstimateToolsTotal,
				Total:        version.TokenEstimateTotal,
			},
		})
	}

	nextCursor := ""
	if nextStoreCursor != nil {
		encoded, err := encodeAgentVersionListCursor(agentVersionListCursor{
			LastSeenNanos: nextStoreCursor.LastSeenAt.UTC().UnixNano(),
			VersionID:     nextStoreCursor.ID,
			FilterHash:    filterHash,
		})
		if err != nil {
			recordQuerySpanError(span, err)
			return nil, "", err
		}
		nextCursor = encoded
	}

	span.SetAttributes(
		attribute.Int("sigil.query.result_count", len(items)),
		attribute.Bool("sigil.query.next_cursor_present", nextCursor != ""),
	)

	return items, nextCursor, nil
}

func normalizeAgentListPageSize(value int) int {
	if value <= 0 {
		return defaultAgentListPageSize
	}
	if value > maxAgentListPageSize {
		return maxAgentListPageSize
	}
	return value
}

func buildAgentListFilterHash(namePrefix string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(namePrefix)))
	return hex.EncodeToString(sum[:])
}

func buildAgentVersionsFilterHash(agentName string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(agentName)))
	return hex.EncodeToString(sum[:])
}

func encodeAgentListCursor(cursor agentListCursor) (string, error) {
	if cursor.LatestSeenNanos <= 0 {
		return "", fmt.Errorf("cursor latest_seen_nanos must be positive")
	}
	if strings.TrimSpace(cursor.FilterHash) == "" {
		return "", fmt.Errorf("cursor filter_hash is required")
	}
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", fmt.Errorf("marshal cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeAgentListCursor(raw string) (agentListCursor, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return agentListCursor{}, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return agentListCursor{}, fmt.Errorf("decode cursor: %w", err)
	}
	var cursor agentListCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return agentListCursor{}, fmt.Errorf("parse cursor: %w", err)
	}
	if cursor.LatestSeenNanos <= 0 {
		return agentListCursor{}, fmt.Errorf("cursor latest_seen_nanos must be positive")
	}
	if strings.TrimSpace(cursor.FilterHash) == "" {
		return agentListCursor{}, fmt.Errorf("cursor filter_hash is required")
	}
	if cursor.HeadID == 0 {
		return agentListCursor{}, fmt.Errorf("cursor head_id must be positive")
	}
	return cursor, nil
}

func encodeAgentVersionListCursor(cursor agentVersionListCursor) (string, error) {
	if cursor.LastSeenNanos <= 0 {
		return "", fmt.Errorf("cursor last_seen_nanos must be positive")
	}
	if cursor.VersionID == 0 {
		return "", fmt.Errorf("cursor version_id must be positive")
	}
	if strings.TrimSpace(cursor.FilterHash) == "" {
		return "", fmt.Errorf("cursor filter_hash is required")
	}
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", fmt.Errorf("marshal cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeAgentVersionListCursor(raw string) (agentVersionListCursor, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return agentVersionListCursor{}, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return agentVersionListCursor{}, fmt.Errorf("decode cursor: %w", err)
	}
	var cursor agentVersionListCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return agentVersionListCursor{}, fmt.Errorf("parse cursor: %w", err)
	}
	if cursor.LastSeenNanos <= 0 {
		return agentVersionListCursor{}, fmt.Errorf("cursor last_seen_nanos must be positive")
	}
	if cursor.VersionID == 0 {
		return agentVersionListCursor{}, fmt.Errorf("cursor version_id must be positive")
	}
	if strings.TrimSpace(cursor.FilterHash) == "" {
		return agentVersionListCursor{}, fmt.Errorf("cursor filter_hash is required")
	}
	return cursor, nil
}
