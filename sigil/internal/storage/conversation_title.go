package storage

import (
	"strings"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

const (
	conversationTitleKey       = "sigil.conversation.title"
	legacyConversationTitleKey = "conversation_title"
)

// ConversationTitleFromGeneration extracts a normalized conversation title from
// generation metadata, including legacy attribute nesting.
func ConversationTitleFromGeneration(generation *sigilv1.Generation) string {
	if generation == nil {
		return ""
	}
	metadata := generation.GetMetadata()
	if metadata == nil {
		return ""
	}
	metadataMap := metadata.AsMap()
	if len(metadataMap) == 0 {
		return ""
	}
	if title := metadataStringFromMap(metadataMap, conversationTitleKey); title != "" {
		return title
	}
	if title := metadataStringFromMap(metadataMap, legacyConversationTitleKey); title != "" {
		return title
	}
	rawAttributes, ok := metadataMap["attributes"]
	if !ok {
		return ""
	}
	attributes, ok := rawAttributes.(map[string]any)
	if !ok {
		return ""
	}
	if title := metadataStringFromMap(attributes, conversationTitleKey); title != "" {
		return title
	}
	return metadataStringFromMap(attributes, legacyConversationTitleKey)
}

// GenerationMetadataString returns the normalized string value for a top-level
// generation metadata key.
func GenerationMetadataString(generation *sigilv1.Generation, key string) string {
	if generation == nil {
		return ""
	}
	metadata := generation.GetMetadata()
	if metadata == nil {
		return ""
	}
	return metadataStringFromMap(metadata.AsMap(), key)
}

func metadataStringFromMap(values map[string]any, key string) string {
	if len(values) == 0 {
		return ""
	}
	raw, ok := values[key]
	if !ok {
		return ""
	}
	return normalizeMetadataString(raw)
}

func normalizeMetadataString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case map[string]any:
		return normalizeMetadataString(typed["stringValue"])
	default:
		return ""
	}
}
