package promptinsights

import (
	"fmt"
	"strings"
)

const analyzerSystemPrompt = `You are an expert evaluator for LLM agent system prompts.

You will receive an agent's system prompt and excerpts from real conversations where this agent was used. Your task is to identify the 3 strongest and 3 weakest sections of the system prompt based on how the agent actually behaved in those conversations.

Evaluation approach:
1. Read the system prompt carefully and identify its distinct sections, instructions, and directives.
2. Review the conversation excerpts to observe the agent's actual behavior.
3. Correlate the agent's behavior back to specific parts of the system prompt.
4. Identify which instructions led to good outcomes and which led to problems.

For each strength and weakness:
- Quote the EXACT substring from the system prompt that you are referencing. The quote must be a verbatim substring that appears in the system prompt text. Do not paraphrase or summarize.
- Keep quotes between 20 and 200 characters long. Quote the most representative fragment of the section.
- Provide a short title (5-10 words).
- Explain why this section is effective or problematic, citing specific patterns you observed in the conversations.

If the conversations show no clear signal for a particular strength or weakness, still provide your best analysis based on the available evidence.

Output rules:
- Return exactly 3 strengths and exactly 3 weaknesses.
- Return only data that conforms to the provided JSON schema.
- Do not include markdown formatting.
- Do not include extra keys outside the schema.
`

const maxExcerptChars = 600

func buildUserPrompt(systemPrompt string, excerpts []ConversationExcerpt) string {
	var b strings.Builder

	b.WriteString("<agent_system_prompt>\n")
	b.WriteString(escapeXML(systemPrompt))
	b.WriteString("\n</agent_system_prompt>\n\n")

	b.WriteString("<conversation_excerpts>\n")
	if len(excerpts) == 0 {
		b.WriteString("  <no_conversations>No conversation data available.</no_conversations>\n")
	} else {
		for i, excerpt := range excerpts {
			fmt.Fprintf(&b, "  <conversation index=\"%d\" id=\"%s\" generations=\"%d\" has_errors=\"%t\" tool_calls=\"%d\">\n",
				i+1,
				escapeXML(excerpt.ConversationID),
				excerpt.GenerationCount,
				excerpt.HasErrors,
				excerpt.ToolCallCount,
			)
			b.WriteString("    <user_input>\n")
			b.WriteString(escapeXML(truncate(excerpt.UserInput, maxExcerptChars)))
			b.WriteString("\n    </user_input>\n")
			b.WriteString("    <assistant_output>\n")
			b.WriteString(escapeXML(truncate(excerpt.AssistantOutput, maxExcerptChars)))
			b.WriteString("\n    </assistant_output>\n")
			b.WriteString("  </conversation>\n")
		}
	}
	b.WriteString("</conversation_excerpts>\n")

	return b.String()
}

func insightsOutputSchema() map[string]any {
	insightSchema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"quote": map[string]any{
				"type":        "string",
				"description": "Exact verbatim substring from the system prompt",
			},
			"title": map[string]any{
				"type":        "string",
				"description": "Short title, 5-10 words",
			},
			"explanation": map[string]any{
				"type":        "string",
				"description": "Why this section is effective or problematic, grounded in conversation evidence",
			},
		},
		"required":             []string{"quote", "title", "explanation"},
		"additionalProperties": false,
	}

	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"strengths": map[string]any{
				"type":  "array",
				"items": insightSchema,
			},
			"weaknesses": map[string]any{
				"type":  "array",
				"items": insightSchema,
			},
		},
		"required":             []string{"strengths", "weaknesses"},
		"additionalProperties": false,
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func escapeXML(raw string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
		"'", "&apos;",
	)
	return replacer.Replace(raw)
}
