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
	if metadata != nil {
		metadataMap := metadata.AsMap()
		if title := metadataFirstStringFromMap(metadataMap, conversationTitleKey, legacyConversationTitleKey); title != "" {
			return title
		}
		rawAttributes, ok := metadataMap["attributes"]
		if ok {
			if attributes, ok := rawAttributes.(map[string]any); ok {
				if title := metadataFirstStringFromMap(attributes, conversationTitleKey, legacyConversationTitleKey); title != "" {
					return title
				}
			}
		}
	}
	return ""
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

// GenerationMetadataFirstString returns the first non-empty normalized string
// value for the provided generation metadata keys, in order.
func GenerationMetadataFirstString(generation *sigilv1.Generation, keys ...string) string {
	for _, key := range keys {
		if value := GenerationMetadataString(generation, key); value != "" {
			return value
		}
	}
	return ""
}

func metadataFirstStringFromMap(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := metadataStringFromMap(values, key); value != "" {
			return value
		}
	}
	return ""
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
