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

	"github.com/grafana/sigil/sigil/internal/agentmeta"
	"github.com/grafana/sigil/sigil/internal/storage"
	"go.opentelemetry.io/otel/attribute"
)

const (
	defaultAgentListPageSize  = 50
	maxAgentListPageSize      = 200
	agentRuntimeTopValueLimit = 5
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
	Deferred        bool   `json:"deferred,omitempty"`
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

type AgentSearchRequest struct {
	Filters    string                      `json:"filters"`
	TimeRange  ConversationSearchTimeRange `json:"time_range"`
	PageSize   int                         `json:"page_size"`
	Cursor     string                      `json:"cursor,omitempty"`
	NamePrefix string                      `json:"name_prefix,omitempty"`
}

type AgentRuntimeContextRequest struct {
	AgentName        string                      `json:"agent_name"`
	EffectiveVersion string                      `json:"effective_version,omitempty"`
	Filters          string                      `json:"filters"`
	TimeRange        ConversationSearchTimeRange `json:"time_range"`
}

type AgentRuntimeValueCount struct {
	Value string `json:"value"`
	Count int64  `json:"count"`
}

type AgentRuntimeContextGroup struct {
	Key    string                   `json:"key"`
	Values []AgentRuntimeValueCount `json:"values"`
}

type AgentRuntimeContextResponse struct {
	MatchingGenerationCount int64                      `json:"matching_generation_count"`
	FirstSeenAt             *time.Time                 `json:"first_seen_at,omitempty"`
	LastSeenAt              *time.Time                 `json:"last_seen_at,omitempty"`
	Groups                  []AgentRuntimeContextGroup `json:"groups"`
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

type AgentListFilter struct {
	NamePrefix string
	SeenAfter  time.Time
	SeenBefore time.Time
}

func (s *Service) ListAgentsForTenant(ctx context.Context, tenantID string, limit int, cursor string, filter AgentListFilter) ([]AgentListItem, string, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.list_agents")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedPrefix := strings.TrimSpace(filter.NamePrefix)
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
	filterHash := buildAgentListFilterHash(trimmedPrefix, filter.SeenAfter, filter.SeenBefore)
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
		attribute.Bool("sigil.query.seen_after_set", !filter.SeenAfter.IsZero()),
		attribute.Bool("sigil.query.seen_before_set", !filter.SeenBefore.IsZero()),
	)

	var storeCursor *storage.AgentHeadCursor
	if cursorState.LatestSeenNanos > 0 {
		storeCursor = &storage.AgentHeadCursor{
			LatestSeenAt: time.Unix(0, cursorState.LatestSeenNanos).UTC(),
			AgentName:    cursorState.AgentName,
			ID:           cursorState.HeadID,
		}
	}

	storeFilter := storage.AgentHeadFilter{
		NamePrefix: trimmedPrefix,
		SeenAfter:  filter.SeenAfter,
		SeenBefore: filter.SeenBefore,
	}
	heads, nextStoreCursor, err := s.agentCatalogStore.ListAgentHeads(ctx, trimmedTenantID, pageSize, storeCursor, storeFilter)
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

func (s *Service) SearchAgentsForTenant(ctx context.Context, tenantID string, request AgentSearchRequest) ([]AgentListItem, string, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.search_agents")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedPrefix := strings.TrimSpace(request.NamePrefix)
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

	from, to, err := validateAgentSearchTimeRange(request.TimeRange)
	if err != nil {
		recordQuerySpanError(span, err)
		return nil, "", err
	}
	parsedFilters, err := parseAgentScopedFilters(request.Filters)
	if err != nil {
		recordQuerySpanError(span, err)
		return nil, "", err
	}

	pageSize := normalizeAgentListPageSize(request.PageSize)
	filterHash := buildAgentSearchFilterHash(trimmedPrefix, from, to, parsedFilters.Raw)
	cursorState, err := decodeAgentListCursor(request.Cursor)
	if err != nil {
		validationErr := NewValidationError("invalid cursor")
		recordQuerySpanError(span, validationErr)
		return nil, "", validationErr
	}
	if strings.TrimSpace(request.Cursor) != "" && cursorState.FilterHash != filterHash {
		validationErr := NewValidationError("cursor no longer matches current filters")
		recordQuerySpanError(span, validationErr)
		return nil, "", validationErr
	}

	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.Int("sigil.query.limit", pageSize),
		attribute.String("sigil.query.agent_name_prefix", trimmedPrefix),
		attribute.String("sigil.query.filters", parsedFilters.Raw),
		attribute.Bool("sigil.query.cursor_provided", strings.TrimSpace(request.Cursor) != ""),
	)

	if parsedFilters.Raw == "" {
		return s.ListAgentsForTenant(ctx, trimmedTenantID, pageSize, request.Cursor, AgentListFilter{
			NamePrefix: trimmedPrefix,
			SeenAfter:  from,
			SeenBefore: to,
		})
	}
	if s.tempoClient == nil {
		err := fmt.Errorf("tempo client is not configured")
		recordQuerySpanError(span, err)
		return nil, "", err
	}

	var storeCursor *storage.AgentHeadCursor
	if cursorState.LatestSeenNanos > 0 {
		storeCursor = &storage.AgentHeadCursor{
			LatestSeenAt: time.Unix(0, cursorState.LatestSeenNanos).UTC(),
			AgentName:    cursorState.AgentName,
			ID:           cursorState.HeadID,
		}
	}

	storeFilter := storage.AgentHeadFilter{
		NamePrefix: trimmedPrefix,
		SeenAfter:  from,
		SeenBefore: to,
	}
	candidateLimit := pageSize * 4
	if candidateLimit < pageSize {
		candidateLimit = pageSize
	}
	if candidateLimit > maxAgentListPageSize {
		candidateLimit = maxAgentListPageSize
	}

	items := make([]AgentListItem, 0, pageSize)
	nextCursor := ""

	for iteration := 0; iteration < defaultTempoSearchMaxIterations*2 && len(items) < pageSize; iteration++ {
		heads, nextStoreCursor, err := s.agentCatalogStore.ListAgentHeads(ctx, trimmedTenantID, candidateLimit, storeCursor, storeFilter)
		if err != nil {
			recordQuerySpanError(span, err)
			return nil, "", err
		}
		if len(heads) == 0 {
			break
		}

		matchedNames, err := s.findMatchingAgentNames(ctx, trimmedTenantID, heads, parsedFilters, from, to)
		if err != nil {
			recordQuerySpanError(span, err)
			return nil, "", err
		}

		for idx, head := range heads {
			if _, ok := matchedNames[head.AgentName]; !ok {
				continue
			}
			items = append(items, agentListItemFromHead(head))
			if len(items) >= pageSize {
				hasMoreCandidates := idx < len(heads)-1 || nextStoreCursor != nil
				if hasMoreCandidates {
					encoded, encodeErr := encodeAgentListCursor(agentListCursor{
						LatestSeenNanos: head.LatestSeenAt.UTC().UnixNano(),
						AgentName:       head.AgentName,
						HeadID:          head.ID,
						FilterHash:      filterHash,
					})
					if encodeErr != nil {
						recordQuerySpanError(span, encodeErr)
						return nil, "", encodeErr
					}
					nextCursor = encoded
				}
				break
			}
		}
		if len(items) >= pageSize {
			break
		}
		if nextStoreCursor == nil {
			break
		}
		storeCursor = nextStoreCursor
	}

	span.SetAttributes(
		attribute.Int("sigil.query.result_count", len(items)),
		attribute.Bool("sigil.query.next_cursor_present", nextCursor != ""),
	)
	return items, nextCursor, nil
}

func (s *Service) GetAgentRuntimeContextForTenant(
	ctx context.Context,
	tenantID string,
	request AgentRuntimeContextRequest,
) (AgentRuntimeContextResponse, error) {
	ctx, span := queryServiceTracer.Start(ctx, "sigil.query.agent_runtime_context")
	defer span.End()

	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedAgentName := strings.TrimSpace(request.AgentName)
	trimmedVersion := strings.TrimSpace(request.EffectiveVersion)
	if trimmedTenantID == "" {
		err := NewValidationError("tenant id is required")
		recordQuerySpanError(span, err)
		return AgentRuntimeContextResponse{}, err
	}
	if s.tempoClient == nil {
		err := fmt.Errorf("tempo client is not configured")
		recordQuerySpanError(span, err)
		return AgentRuntimeContextResponse{}, err
	}
	if trimmedVersion != "" && !effectiveVersionPattern.MatchString(trimmedVersion) {
		err := NewValidationError("invalid effective_version")
		recordQuerySpanError(span, err)
		return AgentRuntimeContextResponse{}, err
	}

	from, to, err := validateAgentSearchTimeRange(request.TimeRange)
	if err != nil {
		recordQuerySpanError(span, err)
		return AgentRuntimeContextResponse{}, err
	}
	parsedFilters, err := parseAgentScopedFilters(request.Filters)
	if err != nil {
		recordQuerySpanError(span, err)
		return AgentRuntimeContextResponse{}, err
	}

	groupKeys := buildAgentRuntimeGroupKeys(parsedFilters)
	selectFields, err := NormalizeSelectFields(groupKeys)
	if err != nil {
		validationErr := NewValidationError(err.Error())
		recordQuerySpanError(span, validationErr)
		return AgentRuntimeContextResponse{}, validationErr
	}

	records, err := s.searchAgentRuntimeRecords(ctx, trimmedTenantID, trimmedAgentName, parsedFilters, selectFields, from, to)
	if err != nil {
		recordQuerySpanError(span, err)
		return AgentRuntimeContextResponse{}, err
	}
	if trimmedVersion != "" {
		records, err = s.filterRuntimeRecordsByEffectiveVersion(ctx, trimmedTenantID, records, trimmedVersion)
		if err != nil {
			recordQuerySpanError(span, err)
			return AgentRuntimeContextResponse{}, err
		}
	}

	response := buildAgentRuntimeContextResponse(records, groupKeys)
	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.String("sigil.agent.name", trimmedAgentName),
		attribute.String("sigil.agent.effective_version", trimmedVersion),
		attribute.Int64("sigil.query.matching_generation_count", response.MatchingGenerationCount),
	)
	return response, nil
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

type agentRuntimeRecord struct {
	GenerationID string
	SeenAt       time.Time
	Values       map[string]string
}

func validateAgentSearchTimeRange(timeRange ConversationSearchTimeRange) (time.Time, time.Time, error) {
	if timeRange.From.IsZero() || timeRange.To.IsZero() {
		return time.Time{}, time.Time{}, NewValidationError("time_range.from and time_range.to are required")
	}
	from := timeRange.From.UTC()
	to := timeRange.To.UTC()
	if !from.Before(to) {
		return time.Time{}, time.Time{}, NewValidationError("time_range.from must be before time_range.to")
	}
	return from, to, nil
}

func parseAgentScopedFilters(raw string) (ParsedFilters, error) {
	parsed, err := ParseFilterExpression(raw)
	if err != nil {
		return ParsedFilters{}, NewValidationError(err.Error())
	}
	for _, term := range parsed.Terms {
		if term.Route != FilterRouteTempo {
			return ParsedFilters{}, NewValidationError("agent filters only support span.* and resource.* keys")
		}
		if strings.HasPrefix(term.RawKey, "resource.") || strings.HasPrefix(term.RawKey, "span.") {
			continue
		}
		return ParsedFilters{}, NewValidationError("agent filters only support span.* and resource.* keys")
	}
	return parsed, nil
}

func agentListItemFromHead(head storage.AgentHead) AgentListItem {
	return AgentListItem{
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
	}
}

func buildAgentSearchFilterHash(namePrefix string, from, to time.Time, filters string) string {
	h := sha256.New()
	h.Write([]byte(strings.TrimSpace(namePrefix)))
	h.Write([]byte{0})
	h.Write([]byte(from.UTC().Format(time.RFC3339Nano)))
	h.Write([]byte{0})
	h.Write([]byte(to.UTC().Format(time.RFC3339Nano)))
	h.Write([]byte{0})
	h.Write([]byte(strings.TrimSpace(filters)))
	return hex.EncodeToString(h.Sum(nil))
}

func (s *Service) findMatchingAgentNames(
	ctx context.Context,
	tenantID string,
	heads []storage.AgentHead,
	parsedFilters ParsedFilters,
	from, to time.Time,
) (map[string]struct{}, error) {
	nonEmptyNames := make([]string, 0, len(heads))
	seen := make(map[string]struct{}, len(heads))
	hasAnonymous := false
	for _, head := range heads {
		name := strings.TrimSpace(head.AgentName)
		if name == "" {
			hasAnonymous = true
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		nonEmptyNames = append(nonEmptyNames, name)
	}

	matched := make(map[string]struct{}, len(nonEmptyNames)+1)
	if len(nonEmptyNames) > 0 {
		namedMatches, err := s.searchMatchedAgentNames(ctx, tenantID, nonEmptyNames, parsedFilters, from, to)
		if err != nil {
			return nil, err
		}
		for name := range namedMatches {
			matched[name] = struct{}{}
		}
	}
	if hasAnonymous {
		anonymousMatches, err := s.searchMatchedAgentNames(ctx, tenantID, []string{""}, parsedFilters, from, to)
		if err != nil {
			return nil, err
		}
		if _, ok := anonymousMatches[""]; ok {
			matched[""] = struct{}{}
		}
	}
	return matched, nil
}

func (s *Service) searchMatchedAgentNames(
	ctx context.Context,
	tenantID string,
	agentNames []string,
	parsedFilters ParsedFilters,
	from, to time.Time,
) (map[string]struct{}, error) {
	matched := make(map[string]struct{}, len(agentNames))
	targets := make(map[string]struct{}, len(agentNames))
	for _, name := range agentNames {
		targets[name] = struct{}{}
	}

	traceQL, err := buildAgentScopedTraceQL(parsedFilters, agentNames, nil)
	if err != nil {
		validationErr := NewValidationError(err.Error())
		return nil, validationErr
	}

	searchEndNanos := to.UnixNano()
	searchLimit := 100
	if len(agentNames)*8 > searchLimit {
		searchLimit = len(agentNames) * 8
	}
	if searchLimit > 500 {
		searchLimit = 500
	}

	for iteration := 0; iteration < defaultTempoSearchMaxIterations && len(matched) < len(targets); iteration++ {
		tempoResponse, err := s.tempoClient.Search(ctx, TempoSearchRequest{
			TenantID:        tenantID,
			Query:           traceQL,
			Limit:           searchLimit,
			Start:           from,
			End:             time.Unix(0, searchEndNanos).UTC(),
			SpansPerSpanSet: defaultTempoSearchSpansPerSpanSet,
		})
		if err != nil {
			return nil, err
		}

		earliestTraceStart := int64(0)
		for _, trace := range tempoResponse.Traces {
			traceStartNanos := parseUnixNanos(trace.StartTimeUnixNano)
			if traceStartNanos > 0 && (earliestTraceStart == 0 || traceStartNanos < earliestTraceStart) {
				earliestTraceStart = traceStartNanos
			}
			for _, spanSet := range trace.SpanSets {
				for _, tempoSpan := range spanSet.Spans {
					attributes := buildTempoAttributeLookup(tempoSpan.Attributes)
					if firstAttributeString(attributes, "sigil.generation.id", "span.sigil.generation.id") == "" {
						continue
					}
					agentName := firstAttributeString(attributes, "gen_ai.agent.name", "span.gen_ai.agent.name")
					if _, ok := targets[agentName]; ok {
						matched[agentName] = struct{}{}
					}
				}
			}
		}

		if earliestTraceStart <= 0 || earliestTraceStart <= from.UnixNano() || len(tempoResponse.Traces) < searchLimit {
			break
		}
		searchEndNanos = earliestTraceStart - 1
	}

	return matched, nil
}

func buildAgentRuntimeGroupKeys(parsed ParsedFilters) []string {
	keys := []string{
		"resource.k8s.namespace.name",
		"resource.k8s.cluster.name",
		"resource.service.name",
	}
	seen := map[string]struct{}{
		"resource.k8s.namespace.name": {},
		"resource.k8s.cluster.name":   {},
		"resource.service.name":       {},
	}
	for _, term := range parsed.TempoTerms {
		key := strings.TrimSpace(term.RawKey)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys
}

func buildAgentScopedTraceQL(parsed ParsedFilters, agentNames []string, selectFields []SelectField) (string, error) {
	combined := ParsedFilters{
		Raw:        parsed.Raw,
		Terms:      append([]FilterTerm{}, parsed.Terms...),
		TempoTerms: append([]FilterTerm{}, parsed.TempoTerms...),
		MySQLTerms: append([]FilterTerm{}, parsed.MySQLTerms...),
	}
	if len(agentNames) > 0 {
		if len(agentNames) == 1 && strings.TrimSpace(agentNames[0]) == "" {
			combined.Terms = append(combined.Terms, FilterTerm{
				RawKey:      "agent",
				ResolvedKey: "span.gen_ai.agent.name",
				Route:       FilterRouteTempo,
				Operator:    FilterOperatorEqual,
				Value:       "",
				WasQuoted:   true,
			})
			combined.TempoTerms = append(combined.TempoTerms, combined.Terms[len(combined.Terms)-1])
		} else {
			combined.Terms = append(combined.Terms, FilterTerm{
				RawKey:      "agent",
				ResolvedKey: "span.gen_ai.agent.name",
				Route:       FilterRouteTempo,
				Operator:    FilterOperatorRegex,
				Value:       buildExactRegex(agentNames),
				WasQuoted:   true,
			})
			combined.TempoTerms = append(combined.TempoTerms, combined.Terms[len(combined.Terms)-1])
		}
	}
	return BuildTraceQL(combined, selectFields)
}

func buildExactRegex(values []string) string {
	escaped := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		escaped = append(escaped, regexp.QuoteMeta(trimmed))
	}
	sort.Strings(escaped)
	return "^(?:" + strings.Join(escaped, "|") + ")$"
}

func (s *Service) searchAgentRuntimeRecords(
	ctx context.Context,
	tenantID string,
	agentName string,
	parsedFilters ParsedFilters,
	selectFields []SelectField,
	from, to time.Time,
) ([]agentRuntimeRecord, error) {
	traceQL, err := buildAgentScopedTraceQL(parsedFilters, []string{agentName}, selectFields)
	if err != nil {
		validationErr := NewValidationError(err.Error())
		return nil, validationErr
	}

	recordsByGeneration := make(map[string]agentRuntimeRecord)
	searchEndNanos := to.UnixNano()
	searchLimit := 200

	for iteration := 0; iteration < defaultTempoSearchMaxIterations; iteration++ {
		tempoResponse, err := s.tempoClient.Search(ctx, TempoSearchRequest{
			TenantID:        tenantID,
			Query:           traceQL,
			Limit:           searchLimit,
			Start:           from,
			End:             time.Unix(0, searchEndNanos).UTC(),
			SpansPerSpanSet: defaultTempoSearchSpansPerSpanSet,
		})
		if err != nil {
			return nil, err
		}

		earliestTraceStart := int64(0)
		for _, trace := range tempoResponse.Traces {
			traceStartNanos := parseUnixNanos(trace.StartTimeUnixNano)
			if traceStartNanos > 0 && (earliestTraceStart == 0 || traceStartNanos < earliestTraceStart) {
				earliestTraceStart = traceStartNanos
			}
			for _, spanSet := range trace.SpanSets {
				for _, tempoSpan := range spanSet.Spans {
					attributes := buildTempoAttributeLookup(tempoSpan.Attributes)
					generationID := firstAttributeString(attributes, "sigil.generation.id", "span.sigil.generation.id")
					if generationID == "" {
						continue
					}
					recordAgentName := firstAttributeString(attributes, "gen_ai.agent.name", "span.gen_ai.agent.name")
					if recordAgentName != agentName {
						continue
					}
					spanStartNanos := parseUnixNanos(tempoSpan.StartTimeUnixNano)
					if spanStartNanos <= 0 {
						spanStartNanos = traceStartNanos
					}
					record := agentRuntimeRecord{
						GenerationID: generationID,
						SeenAt:       time.Unix(0, spanStartNanos).UTC(),
						Values:       make(map[string]string, len(selectFields)),
					}
					for _, field := range selectFields {
						if value, ok := attributes[field.ResolvedKey]; ok {
							if asString, ok := value.stringValue(); ok {
								record.Values[field.Key] = strings.TrimSpace(asString)
								continue
							}
							if numeric, ok := value.floatValue(); ok {
								record.Values[field.Key] = fmt.Sprintf("%g", numeric)
								continue
							}
							if boolean, ok := value.boolValue(); ok {
								if boolean {
									record.Values[field.Key] = "true"
								} else {
									record.Values[field.Key] = "false"
								}
							}
						}
					}
					if existing, ok := recordsByGeneration[generationID]; ok && !record.SeenAt.After(existing.SeenAt) {
						continue
					}
					recordsByGeneration[generationID] = record
				}
			}
		}

		if earliestTraceStart <= 0 || earliestTraceStart <= from.UnixNano() || len(tempoResponse.Traces) < searchLimit {
			break
		}
		searchEndNanos = earliestTraceStart - 1
	}

	records := make([]agentRuntimeRecord, 0, len(recordsByGeneration))
	for _, record := range recordsByGeneration {
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].SeenAt.Equal(records[j].SeenAt) {
			return records[i].GenerationID < records[j].GenerationID
		}
		return records[i].SeenAt.Before(records[j].SeenAt)
	})
	return records, nil
}

func (s *Service) filterRuntimeRecordsByEffectiveVersion(
	ctx context.Context,
	tenantID string,
	records []agentRuntimeRecord,
	effectiveVersion string,
) ([]agentRuntimeRecord, error) {
	if len(records) == 0 {
		return []agentRuntimeRecord{}, nil
	}
	fanOutStore := s.fanOutStore
	if fanOutStore == nil {
		if s.walReader == nil {
			return nil, fmt.Errorf("wal reader is not configured")
		}
		fanOutStore = storage.NewFanOutStore(s.walReader, nil, nil)
	}

	filtered := make([]agentRuntimeRecord, 0, len(records))
	for _, record := range records {
		generation, err := fanOutStore.GetGenerationByID(ctx, tenantID, record.GenerationID)
		if err != nil {
			return nil, err
		}
		if generation == nil {
			continue
		}
		descriptor, err := agentmeta.BuildDescriptor(generation)
		if err != nil {
			return nil, fmt.Errorf("build agent descriptor: %w", err)
		}
		if descriptor.EffectiveVersion == effectiveVersion {
			filtered = append(filtered, record)
		}
	}
	return filtered, nil
}

func buildAgentRuntimeContextResponse(records []agentRuntimeRecord, groupKeys []string) AgentRuntimeContextResponse {
	response := AgentRuntimeContextResponse{
		Groups: []AgentRuntimeContextGroup{},
	}
	if len(records) == 0 {
		return response
	}

	response.MatchingGenerationCount = int64(len(records))
	firstSeen := records[0].SeenAt.UTC()
	lastSeen := records[0].SeenAt.UTC()
	countsByKey := make(map[string]map[string]int64, len(groupKeys))
	for _, key := range groupKeys {
		countsByKey[key] = make(map[string]int64)
	}

	for _, record := range records {
		if record.SeenAt.Before(firstSeen) {
			firstSeen = record.SeenAt.UTC()
		}
		if record.SeenAt.After(lastSeen) {
			lastSeen = record.SeenAt.UTC()
		}
		for _, key := range groupKeys {
			value := strings.TrimSpace(record.Values[key])
			if value == "" {
				continue
			}
			countsByKey[key][value]++
		}
	}
	response.FirstSeenAt = &firstSeen
	response.LastSeenAt = &lastSeen

	for _, key := range groupKeys {
		valueCounts := countsByKey[key]
		if len(valueCounts) == 0 {
			continue
		}
		values := make([]AgentRuntimeValueCount, 0, len(valueCounts))
		for value, count := range valueCounts {
			values = append(values, AgentRuntimeValueCount{Value: value, Count: count})
		}
		sort.Slice(values, func(i, j int) bool {
			if values[i].Count == values[j].Count {
				return values[i].Value < values[j].Value
			}
			return values[i].Count > values[j].Count
		})
		if len(values) > agentRuntimeTopValueLimit {
			values = values[:agentRuntimeTopValueLimit]
		}
		response.Groups = append(response.Groups, AgentRuntimeContextGroup{
			Key:    key,
			Values: values,
		})
	}
	return response
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

func buildAgentListFilterHash(namePrefix string, seenAfter, seenBefore time.Time) string {
	h := sha256.New()
	h.Write([]byte(strings.TrimSpace(namePrefix)))
	h.Write([]byte{0})
	if !seenAfter.IsZero() {
		h.Write([]byte(seenAfter.UTC().Format(time.RFC3339)))
	}
	h.Write([]byte{0})
	if !seenBefore.IsZero() {
		h.Write([]byte(seenBefore.UTC().Format(time.RFC3339)))
	}
	return hex.EncodeToString(h.Sum(nil))
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
