package query

import (
	"encoding/json"
	"fmt"
	"time"
)

type ConversationDetailV2 struct {
	ConversationID    string                     `json:"conversation_id"`
	ConversationTitle string                     `json:"conversation_title,omitempty"`
	UserID            string                     `json:"user_id,omitempty"`
	GenerationCount   int                        `json:"generation_count"`
	FirstGenerationAt string                     `json:"first_generation_at"`
	LastGenerationAt  string                     `json:"last_generation_at"`
	Generations       []map[string]any           `json:"generations"`
	HasMore           bool                       `json:"has_more"`
	NextCursor        string                     `json:"next_cursor,omitempty"`
	RatingSummary     any                        `json:"rating_summary,omitempty"`
	Annotations       any                        `json:"annotations"`
	Shared            ConversationDetailV2Shared `json:"shared"`
}

type ConversationDetailV2Shared struct {
	Messages      []map[string]any `json:"messages,omitempty"`
	Tools         []map[string]any `json:"tools,omitempty"`
	SystemPrompts []string         `json:"system_prompts,omitempty"`
	Metadata      []map[string]any `json:"metadata,omitempty"`
}

type conversationDetailInternPool struct {
	messageRefs      map[string]int
	toolRefs         map[string]int
	systemPromptRefs map[string]int
	metadataRefs     map[string]int
	shared           ConversationDetailV2Shared
}

func newConversationDetailInternPool() *conversationDetailInternPool {
	return &conversationDetailInternPool{
		messageRefs:      make(map[string]int),
		toolRefs:         make(map[string]int),
		systemPromptRefs: make(map[string]int),
		metadataRefs:     make(map[string]int),
	}
}

func BuildConversationDetailV2(detail ConversationDetail) (ConversationDetailV2, error) {
	pool := newConversationDetailInternPool()
	generations := make([]map[string]any, 0, len(detail.Generations))
	for _, payload := range detail.Generations {
		next, err := pool.internGeneration(payload)
		if err != nil {
			return ConversationDetailV2{}, err
		}
		generations = append(generations, next)
	}

	return ConversationDetailV2{
		ConversationID:    detail.ConversationID,
		ConversationTitle: detail.ConversationTitle,
		UserID:            detail.UserID,
		GenerationCount:   detail.GenerationCount,
		FirstGenerationAt: detail.FirstGenerationAt.UTC().Format(time.RFC3339Nano),
		LastGenerationAt:  detail.LastGenerationAt.UTC().Format(time.RFC3339Nano),
		Generations:       generations,
		HasMore:           detail.HasMore,
		NextCursor:        detail.NextCursor,
		RatingSummary:     detail.RatingSummary,
		Annotations:       detail.Annotations,
		Shared:            pool.shared,
	}, nil
}

func (p *conversationDetailInternPool) internGeneration(payload map[string]any) (map[string]any, error) {
	next := cloneAnyMap(payload)

	if refs, ok, err := p.internArrayOfObjects(next, "input", p.messageRefs, &p.shared.Messages); err != nil {
		return nil, err
	} else if ok {
		next["input_refs"] = refs
	}
	if refs, ok, err := p.internArrayOfObjects(next, "output", p.messageRefs, &p.shared.Messages); err != nil {
		return nil, err
	} else if ok {
		next["output_refs"] = refs
	}
	if refs, ok, err := p.internArrayOfObjects(next, "tools", p.toolRefs, &p.shared.Tools); err != nil {
		return nil, err
	} else if ok {
		next["tool_refs"] = refs
	}
	if ref, ok, err := p.internString(next, "system_prompt", p.systemPromptRefs, &p.shared.SystemPrompts); err != nil {
		return nil, err
	} else if ok {
		next["system_prompt_ref"] = ref
	}
	if ref, ok, err := p.internObject(next, "metadata", p.metadataRefs, &p.shared.Metadata); err != nil {
		return nil, err
	} else if ok {
		next["metadata_ref"] = ref
	}

	return next, nil
}

func (p *conversationDetailInternPool) internArrayOfObjects(
	payload map[string]any,
	field string,
	refs map[string]int,
	dest *[]map[string]any,
) ([]int, bool, error) {
	raw, ok := payload[field]
	if !ok {
		return nil, false, nil
	}
	delete(payload, field)

	items, ok := raw.([]any)
	if !ok {
		return nil, false, nil
	}
	if len(items) == 0 {
		return []int{}, true, nil
	}

	out := make([]int, 0, len(items))
	for _, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, false, fmt.Errorf("conversation detail v2: %s item has unexpected type %T", field, item)
		}
		keyBytes, err := json.Marshal(object)
		if err != nil {
			return nil, false, fmt.Errorf("conversation detail v2: marshal %s item: %w", field, err)
		}
		key := string(keyBytes)
		ref, found := refs[key]
		if !found {
			ref = len(*dest)
			refs[key] = ref
			*dest = append(*dest, cloneAnyMap(object))
		}
		out = append(out, ref)
	}

	return out, true, nil
}

func (p *conversationDetailInternPool) internString(
	payload map[string]any,
	field string,
	refs map[string]int,
	dest *[]string,
) (int, bool, error) {
	raw, ok := payload[field]
	if !ok {
		return 0, false, nil
	}
	delete(payload, field)

	value, ok := raw.(string)
	if !ok || value == "" {
		return 0, false, nil
	}

	ref, found := refs[value]
	if !found {
		ref = len(*dest)
		refs[value] = ref
		*dest = append(*dest, value)
	}
	return ref, true, nil
}

func (p *conversationDetailInternPool) internObject(
	payload map[string]any,
	field string,
	refs map[string]int,
	dest *[]map[string]any,
) (int, bool, error) {
	raw, ok := payload[field]
	if !ok {
		return 0, false, nil
	}
	delete(payload, field)

	object, ok := raw.(map[string]any)
	if !ok {
		return 0, false, nil
	}

	keyBytes, err := json.Marshal(object)
	if err != nil {
		return 0, false, fmt.Errorf("conversation detail v2: marshal %s: %w", field, err)
	}
	key := string(keyBytes)
	ref, found := refs[key]
	if !found {
		ref = len(*dest)
		refs[key] = ref
		*dest = append(*dest, cloneAnyMap(object))
	}
	return ref, true, nil
}

func cloneAnyMap(src map[string]any) map[string]any {
	if len(src) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(src))
	for key, value := range src {
		out[key] = cloneAnyValue(value)
	}
	return out
}

func cloneAnyValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneAnyMap(typed)
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = cloneAnyValue(item)
		}
		return out
	default:
		return typed
	}
}
