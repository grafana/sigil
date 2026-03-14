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
	metadata := generationMetadataMap(generation)
	if title := firstMetadataString(metadata, conversationTitleKey, legacyConversationTitleKey); title != "" {
		return title
	}
	if attributes, ok := metadata["attributes"].(map[string]any); ok {
		if title := firstMetadataString(attributes, conversationTitleKey, legacyConversationTitleKey); title != "" {
			return title
		}
	}
	return ""
}

// GenerationMetadataString returns the normalized string value for a top-level
// generation metadata key.
func GenerationMetadataString(generation *sigilv1.Generation, key string) string {
	return metadataStringFromMap(generationMetadataMap(generation), key)
}

// GenerationMetadataFirstString returns the first non-empty normalized string
// value for the provided generation metadata keys, in order.
func GenerationMetadataFirstString(generation *sigilv1.Generation, keys ...string) string {
	return firstMetadataString(generationMetadataMap(generation), keys...)
}

func generationMetadataMap(generation *sigilv1.Generation) map[string]any {
	if generation == nil {
		return nil
	}
	metadata := generation.GetMetadata()
	if metadata == nil {
		return nil
	}
	return metadata.AsMap()
}

func firstMetadataString(values map[string]any, keys ...string) string {
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
