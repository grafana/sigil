package evaluators

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

func buildLLMJudgeTemplateVars(input EvalInput) map[string]string {
	vars := map[string]string{
		"generation_id":   input.GenerationID,
		"conversation_id": input.ConversationID,
		"system_prompt":   "",
	}

	if input.Generation == nil {
		vars["latest_user_message"] = input.InputText
		vars["user_history"] = input.InputText
		vars["assistant_response"] = input.ResponseText
		vars["assistant_thinking"] = ""
		vars["assistant_sequence"] = input.ResponseText
		vars["tool_calls"] = ""
		vars["tool_results"] = ""
		vars["tools"] = ""
		vars["stop_reason"] = ""
		vars["input"] = input.InputText
		vars["output"] = input.ResponseText
		vars["call_error"] = ""
		vars["error"] = ""
		return vars
	}

	gen := input.Generation

	latestUserMessage := renderLatestUserMessage(gen.GetInput())
	userHistory := renderUserHistory(gen.GetInput())
	assistantResponse := renderAssistantResponse(gen.GetOutput())
	callError := strings.TrimSpace(gen.GetCallError())

	vars["system_prompt"] = strings.TrimSpace(gen.GetSystemPrompt())
	vars["latest_user_message"] = latestUserMessage
	vars["user_history"] = userHistory
	vars["assistant_response"] = assistantResponse
	vars["assistant_thinking"] = renderAssistantThinking(gen.GetOutput())
	vars["assistant_sequence"] = renderAssistantSequence(gen.GetOutput())
	vars["tool_calls"] = renderToolCalls(gen.GetOutput())
	vars["tool_results"] = renderToolResults(gen.GetInput())
	vars["tools"] = renderTools(gen.GetTools())
	vars["stop_reason"] = strings.TrimSpace(gen.GetStopReason())
	vars["call_error"] = callError
	vars["error"] = callError
	vars["input"] = latestUserMessage
	vars["output"] = assistantResponse

	return vars
}

func renderLatestUserMessage(messages []*sigilv1.Message) string {
	var latest string
	for _, message := range messages {
		if message == nil || message.GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_USER {
			continue
		}
		if rendered := renderTextParts(message.GetParts()); rendered != "" {
			latest = rendered
		}
	}
	return latest
}

func renderUserHistory(messages []*sigilv1.Message) string {
	blocks := make([]string, 0, len(messages))
	index := 1
	for _, message := range messages {
		if message == nil || message.GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_USER {
			continue
		}
		rendered := renderTextParts(message.GetParts())
		if rendered == "" {
			continue
		}
		blocks = append(blocks, fmt.Sprintf("<message index=\"%d\">\n%s\n</message>", index, escapeTagText(rendered)))
		index++
	}
	return strings.Join(blocks, "\n")
}

func renderAssistantResponse(messages []*sigilv1.Message) string {
	parts := make([]string, 0, len(messages))
	for _, message := range messages {
		if message == nil || message.GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT {
			continue
		}
		for _, part := range message.GetParts() {
			if part == nil {
				continue
			}
			if text := strings.TrimSpace(part.GetText()); text != "" {
				parts = append(parts, text)
			}
		}
	}
	return strings.Join(parts, "\n")
}

func renderAssistantThinking(messages []*sigilv1.Message) string {
	blocks := make([]string, 0)
	for _, message := range messages {
		if message == nil || message.GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT {
			continue
		}
		for _, part := range message.GetParts() {
			if part == nil {
				continue
			}
			if thinking := strings.TrimSpace(part.GetThinking()); thinking != "" {
				blocks = append(blocks, renderThinkingPart(part))
			}
		}
	}
	return strings.Join(blocks, "\n")
}

func renderAssistantSequence(messages []*sigilv1.Message) string {
	blocks := make([]string, 0)
	for _, message := range messages {
		if message == nil || message.GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT {
			continue
		}
		for _, part := range message.GetParts() {
			if block := renderPart(part); block != "" {
				blocks = append(blocks, block)
			}
		}
	}
	return strings.Join(blocks, "\n")
}

func renderToolCalls(messages []*sigilv1.Message) string {
	blocks := make([]string, 0)
	for _, message := range messages {
		if message == nil || message.GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT {
			continue
		}
		for _, part := range message.GetParts() {
			if part == nil || part.GetToolCall() == nil {
				continue
			}
			blocks = append(blocks, renderToolCallPart(part))
		}
	}
	return strings.Join(blocks, "\n")
}

func renderToolResults(messages []*sigilv1.Message) string {
	blocks := make([]string, 0)
	for _, message := range messages {
		if message == nil || message.GetRole() != sigilv1.MessageRole_MESSAGE_ROLE_TOOL {
			continue
		}
		for _, part := range message.GetParts() {
			if part == nil || part.GetToolResult() == nil {
				continue
			}
			blocks = append(blocks, renderToolResultPart(part))
		}
	}
	return strings.Join(blocks, "\n")
}

func renderTools(tools []*sigilv1.ToolDefinition) string {
	blocks := make([]string, 0, len(tools))
	for _, tool := range tools {
		if tool == nil {
			continue
		}
		attrs := []string{fmt.Sprintf("name=\"%s\"", escapeTagAttr(strings.TrimSpace(tool.GetName())))}
		if toolType := strings.TrimSpace(tool.GetType()); toolType != "" {
			attrs = append(attrs, fmt.Sprintf("type=\"%s\"", escapeTagAttr(toolType)))
		}
		if tool.GetDeferred() {
			attrs = append(attrs, "deferred=\"true\"")
		}

		lines := make([]string, 0, 2)
		if description := strings.TrimSpace(tool.GetDescription()); description != "" {
			lines = append(lines, fmt.Sprintf("<description>%s</description>", escapeTagText(description)))
		}
		if summary := summarizeToolSchema(tool.GetInputSchemaJson()); summary != "" {
			lines = append(lines, fmt.Sprintf("<input_schema_summary>%s</input_schema_summary>", escapeTagText(summary)))
		}

		if len(lines) == 0 {
			blocks = append(blocks, fmt.Sprintf("<tool %s />", strings.Join(attrs, " ")))
			continue
		}
		blocks = append(blocks, fmt.Sprintf("<tool %s>\n%s\n</tool>", strings.Join(attrs, " "), strings.Join(lines, "\n")))
	}
	return strings.Join(blocks, "\n")
}

func summarizeToolSchema(raw []byte) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return ""
	}

	var schema map[string]any
	if err := json.Unmarshal([]byte(trimmed), &schema); err != nil {
		return "schema_present=true"
	}

	summaries := make([]string, 0, 2)
	if props, ok := schema["properties"].(map[string]any); ok && len(props) > 0 {
		keys := make([]string, 0, len(props))
		for key := range props {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		summaries = append(summaries, "properties: "+strings.Join(keys, ", "))
	}
	if required := toStringSlice(schema["required"]); len(required) > 0 {
		sort.Strings(required)
		summaries = append(summaries, "required: "+strings.Join(required, ", "))
	}
	if len(summaries) == 0 {
		return "schema_present=true"
	}
	return strings.Join(summaries, "; ")
}

func renderTextParts(parts []*sigilv1.Part) string {
	lines := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == nil {
			continue
		}
		if text := strings.TrimSpace(part.GetText()); text != "" {
			lines = append(lines, text)
		}
	}
	return strings.Join(lines, "\n")
}

func renderPart(part *sigilv1.Part) string {
	if part == nil {
		return ""
	}
	switch {
	case strings.TrimSpace(part.GetText()) != "":
		return renderTextPart(part)
	case strings.TrimSpace(part.GetThinking()) != "":
		return renderThinkingPart(part)
	case part.GetToolCall() != nil:
		return renderToolCallPart(part)
	case part.GetToolResult() != nil:
		return renderToolResultPart(part)
	default:
		return ""
	}
}

func renderTextPart(part *sigilv1.Part) string {
	return fmt.Sprintf("<text>%s</text>", escapeTagText(strings.TrimSpace(part.GetText())))
}

func renderThinkingPart(part *sigilv1.Part) string {
	attrs := renderProviderTypeAttr(part)
	return fmt.Sprintf("<thinking%s>%s</thinking>", attrs, escapeTagText(strings.TrimSpace(part.GetThinking())))
}

func renderToolCallPart(part *sigilv1.Part) string {
	call := part.GetToolCall()
	if call == nil {
		return ""
	}
	attrs := []string{}
	if name := strings.TrimSpace(call.GetName()); name != "" {
		attrs = append(attrs, fmt.Sprintf("name=\"%s\"", escapeTagAttr(name)))
	}
	if id := strings.TrimSpace(call.GetId()); id != "" {
		attrs = append(attrs, fmt.Sprintf("id=\"%s\"", escapeTagAttr(id)))
	}
	if providerType := strings.TrimSpace(part.GetMetadata().GetProviderType()); providerType != "" {
		attrs = append(attrs, fmt.Sprintf("provider_type=\"%s\"", escapeTagAttr(providerType)))
	}
	body := escapeTagText(strings.TrimSpace(string(call.GetInputJson())))
	if body == "" {
		return fmt.Sprintf("<tool_call %s />", strings.Join(attrs, " "))
	}
	return fmt.Sprintf("<tool_call %s>\n%s\n</tool_call>", strings.Join(attrs, " "), body)
}

func renderToolResultPart(part *sigilv1.Part) string {
	result := part.GetToolResult()
	if result == nil {
		return ""
	}
	attrs := []string{}
	if name := strings.TrimSpace(result.GetName()); name != "" {
		attrs = append(attrs, fmt.Sprintf("name=\"%s\"", escapeTagAttr(name)))
	}
	if id := strings.TrimSpace(result.GetToolCallId()); id != "" {
		attrs = append(attrs, fmt.Sprintf("id=\"%s\"", escapeTagAttr(id)))
	}
	if result.GetIsError() {
		attrs = append(attrs, "error=\"true\"")
	}
	if providerType := strings.TrimSpace(part.GetMetadata().GetProviderType()); providerType != "" {
		attrs = append(attrs, fmt.Sprintf("provider_type=\"%s\"", escapeTagAttr(providerType)))
	}

	body := strings.TrimSpace(result.GetContent())
	if body == "" && len(result.GetContentJson()) > 0 {
		body = strings.TrimSpace(string(result.GetContentJson()))
	}
	body = escapeTagText(body)
	if body == "" {
		return fmt.Sprintf("<tool_result %s />", strings.Join(attrs, " "))
	}
	return fmt.Sprintf("<tool_result %s>\n%s\n</tool_result>", strings.Join(attrs, " "), body)
}

func renderProviderTypeAttr(part *sigilv1.Part) string {
	if part == nil || part.GetMetadata() == nil {
		return ""
	}
	providerType := strings.TrimSpace(part.GetMetadata().GetProviderType())
	if providerType == "" {
		return ""
	}
	return fmt.Sprintf(" provider_type=\"%s\"", escapeTagAttr(providerType))
}

func escapeTagText(raw string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
	)
	return replacer.Replace(raw)
}

func escapeTagAttr(raw string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
		"'", "&apos;",
	)
	return replacer.Replace(raw)
}
