package agentmeta

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

const (
	effectiveVersionPrefix = "sha256:"
	canonicalVersion       = 2
	systemPromptPrefixMax  = 160
)

type Tool struct {
	Name            string `json:"name"`
	Description     string `json:"description"`
	Type            string `json:"type"`
	InputSchemaJSON string `json:"input_schema_json"`
	TokenEstimate   int    `json:"token_estimate"`
}

type Descriptor struct {
	AgentName                 string
	DeclaredVersion           string
	EffectiveVersion          string
	SystemPrompt              string
	SystemPromptPrefix        string
	Tools                     []Tool
	ToolsJSON                 string
	ToolCount                 int
	TokenEstimateSystemPrompt int
	TokenEstimateToolsTotal   int
	TokenEstimateTotal        int
	ModelProvider             string
	ModelName                 string
}

type hashEnvelope struct {
	CanonicalVersion int        `json:"canonical_version"`
	SystemPrompt     string     `json:"system_prompt"`
	Tools            []hashTool `json:"tools"`
}

type hashTool struct {
	Name            string `json:"name"`
	Description     string `json:"description"`
	Type            string `json:"type"`
	InputSchemaJSON string `json:"input_schema_json"`
}

func BuildDescriptor(generation *sigilv1.Generation) (Descriptor, error) {
	if generation == nil {
		return Descriptor{}, fmt.Errorf("generation is required")
	}

	agentName := strings.TrimSpace(generation.GetAgentName())
	declaredVersion := strings.TrimSpace(generation.GetAgentVersion())
	// Preserve raw system prompt bytes for API display and effective-version hashing.
	systemPrompt := generation.GetSystemPrompt()
	systemPromptPrefix := ClampRunes(systemPrompt, systemPromptPrefixMax)
	systemPromptTokens := estimateTokens(systemPrompt)

	tools := make([]Tool, 0, len(generation.GetTools()))
	toolTokenTotal := 0
	for _, definition := range generation.GetTools() {
		if definition == nil {
			continue
		}

		tool := Tool{
			Name:            definition.GetName(),
			Description:     definition.GetDescription(),
			Type:            definition.GetType(),
			InputSchemaJSON: string(definition.GetInputSchemaJson()),
		}
		tool.TokenEstimate = estimateTokens(strings.Join([]string{
			tool.Name,
			tool.Description,
			tool.Type,
			tool.InputSchemaJSON,
		}, " "))
		toolTokenTotal += tool.TokenEstimate

		tools = append(tools, tool)
	}

	sort.Slice(tools, func(i, j int) bool {
		return compareTools(tools[i], tools[j]) < 0
	})

	hashTools := make([]hashTool, len(tools))
	for i, t := range tools {
		hashTools[i] = hashTool{
			Name:            t.Name,
			Description:     t.Description,
			Type:            t.Type,
			InputSchemaJSON: t.InputSchemaJSON,
		}
	}

	toolsJSONBytes, err := json.Marshal(tools)
	if err != nil {
		return Descriptor{}, fmt.Errorf("marshal tools json: %w", err)
	}

	hashBytes, err := json.Marshal(hashEnvelope{
		CanonicalVersion: canonicalVersion,
		SystemPrompt:     systemPrompt,
		Tools:            hashTools,
	})
	if err != nil {
		return Descriptor{}, fmt.Errorf("marshal hash payload: %w", err)
	}

	sum := sha256.Sum256(hashBytes)
	effectiveVersion := effectiveVersionPrefix + hex.EncodeToString(sum[:])

	return Descriptor{
		AgentName:                 agentName,
		DeclaredVersion:           declaredVersion,
		EffectiveVersion:          effectiveVersion,
		SystemPrompt:              systemPrompt,
		SystemPromptPrefix:        systemPromptPrefix,
		Tools:                     tools,
		ToolsJSON:                 string(toolsJSONBytes),
		ToolCount:                 len(tools),
		TokenEstimateSystemPrompt: systemPromptTokens,
		TokenEstimateToolsTotal:   toolTokenTotal,
		TokenEstimateTotal:        systemPromptTokens + toolTokenTotal,
		ModelProvider:             strings.TrimSpace(generation.GetModel().GetProvider()),
		ModelName:                 strings.TrimSpace(generation.GetModel().GetName()),
	}, nil
}

func estimateTokens(value string) int {
	if strings.TrimSpace(value) == "" {
		return 0
	}
	charCount := utf8.RuneCountInString(value)
	return (charCount + 3) / 4
}

func ClampRunes(value string, limit int) string {
	if limit <= 0 || value == "" {
		return ""
	}
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}

func compareTools(left, right Tool) int {
	if diff := strings.Compare(left.Name, right.Name); diff != 0 {
		return diff
	}
	if diff := strings.Compare(left.Type, right.Type); diff != 0 {
		return diff
	}
	if diff := strings.Compare(left.Description, right.Description); diff != 0 {
		return diff
	}
	return strings.Compare(left.InputSchemaJSON, right.InputSchemaJSON)
}
