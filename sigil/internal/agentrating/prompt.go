package agentrating

import (
	"encoding/json"
	"fmt"
	"strings"
)

const evaluatorSystemPrompt = `You are an expert evaluator for LLM agent design quality.

Evaluate the provided agent profile against modern best practices from Anthropic, OpenAI, and Google Gemini guidance.

You must score the agent from 0 to 10 and provide actionable suggestions.

Evaluation checklist:
1) System prompt quality
   - Clear role and responsibility
   - Clear instructions with minimal ambiguity
   - No contradictions or redundant directives
   - Positive framing (tell the model what to do)
   - Explicit output expectations and formatting requirements
   - Appropriate tone guidance
   - Examples or few-shot demonstrations when useful
   - Reasonable complexity for the expected behavior

2) Prompt structure quality
   - Structured sections for instructions, context, examples, and inputs
   - XML-like delimiters or other unambiguous separators for long prompts
   - Limited markdown clutter
   - No emoji noise in policy text
   - Long context placement is sensible

3) Tooling quality
   - Tool names are specific and distinguishable
   - Tool descriptions are concrete and operational
   - Input schemas are clear and not overly complex
   - Deferred tools are clearly identified and applied intentionally
   - Tool count is reasonable for reliability
   - Overlapping tools are minimized
   - High-risk tools should imply stronger guardrails

4) Token budget quality
   - Total baseline context cost is reasonable
   - Any single tool should not dominate context unnecessarily
   - Deferred tools are dynamically loaded and should be penalized less for baseline context cost than immediate tools
   - Warn explicitly when total estimated prompt+tool tokens exceed 30000

5) Operational quality
   - Guidance for uncertainty and failure handling
   - Guidance for safe behavior and guardrails
   - Guidance is practical to follow during real tool use

Scoring rubric:
- 9-10: Excellent, production-grade design with only minor tweaks needed
- 7-8: Strong design with meaningful but limited improvements needed
- 5-6: Functional but average; several important improvements needed
- 3-4: Weak design; major issues in structure, tools, or clarity
- 0-2: Poor design; missing core elements

Suggestion rules:
- Suggestions must be specific and actionable.
- Prioritize highest-impact fixes first.
- Use severity values: "high", "medium", or "low".
- Use category values such as: "system_prompt", "formatting", "tools", "tokens", "guardrails", "workflow".

Output rules:
- Return only data that conforms to the provided JSON schema.
- Do not include markdown.
- Do not include extra keys outside the schema.
`

func buildUserPrompt(agent Agent) string {
	toolCount := len(agent.Tools)
	maxToolName := ""
	maxToolTokens := 0
	toolsWithManyParams := 0
	deferredToolCount := 0
	immediateToolsTotal := 0
	for _, tool := range agent.Tools {
		if tool.TokenEstimate > maxToolTokens {
			maxToolTokens = tool.TokenEstimate
			maxToolName = tool.Name
		}
		if estimateParameterCount(tool.InputSchemaJSON) > 10 {
			toolsWithManyParams++
		}
		if tool.Deferred {
			deferredToolCount++
		} else {
			immediateToolsTotal += tool.TokenEstimate
		}
	}
	baselineTotal := agent.TokenEstimate.SystemPrompt + immediateToolsTotal

	var builder strings.Builder
	builder.WriteString("<agent_profile>\n")
	fmt.Fprintf(&builder, "  <agent_name>%s</agent_name>\n", escapeXML(agent.Name))
	builder.WriteString("  <models>\n")
	if len(agent.Models) == 0 {
		builder.WriteString("    <model>unknown</model>\n")
	} else {
		for _, model := range agent.Models {
			fmt.Fprintf(&builder, "    <model>%s</model>\n", escapeXML(model))
		}
	}
	builder.WriteString("  </models>\n")
	fmt.Fprintf(
		&builder,
		"  <token_estimate system_prompt=\"%d\" tools_total=\"%d\" total=\"%d\" declared_tools_total=\"%d\" declared_total=\"%d\" />\n",
		agent.TokenEstimate.SystemPrompt,
		immediateToolsTotal,
		baselineTotal,
		agent.TokenEstimate.ToolsTotal,
		agent.TokenEstimate.Total,
	)
	builder.WriteString("  <derived_metrics>\n")
	fmt.Fprintf(&builder, "    <tool_count>%d</tool_count>\n", toolCount)
	fmt.Fprintf(&builder, "    <max_tool_tokens>%d</max_tool_tokens>\n", maxToolTokens)
	fmt.Fprintf(&builder, "    <max_tool_name>%s</max_tool_name>\n", escapeXML(maxToolName))
	fmt.Fprintf(&builder, "    <tools_with_more_than_10_params>%d</tools_with_more_than_10_params>\n", toolsWithManyParams)
	fmt.Fprintf(&builder, "    <deferred_tool_count>%d</deferred_tool_count>\n", deferredToolCount)
	fmt.Fprintf(&builder, "    <immediate_tool_count>%d</immediate_tool_count>\n", toolCount-deferredToolCount)
	builder.WriteString("  </derived_metrics>\n")
	builder.WriteString("  <deferred_tools_note>Deferred tools are loaded dynamically and should be penalized less for baseline context cost than immediate tools. Use tools_total and total for baseline context cost, and compare them against declared_tools_total and declared_total to understand deferred-tool overhead.</deferred_tools_note>\n")
	builder.WriteString("  <system_prompt>\n")
	builder.WriteString(escapeXML(agent.SystemPrompt))
	builder.WriteString("\n  </system_prompt>\n")
	builder.WriteString("  <tools>\n")
	if toolCount == 0 {
		builder.WriteString("    <tool name=\"none\" />\n")
	} else {
		for index, tool := range agent.Tools {
			fmt.Fprintf(
				&builder,
				"    <tool index=\"%d\" name=\"%s\" type=\"%s\" token_estimate=\"%d\" parameter_count=\"%d\" deferred=\"%t\">\n",
				index+1,
				escapeXML(tool.Name),
				escapeXML(tool.Type),
				tool.TokenEstimate,
				estimateParameterCount(tool.InputSchemaJSON),
				tool.Deferred,
			)
			fmt.Fprintf(&builder, "      <description>%s</description>\n", escapeXML(tool.Description))
			fmt.Fprintf(&builder, "      <input_schema_json>%s</input_schema_json>\n", escapeXML(tool.InputSchemaJSON))
			builder.WriteString("    </tool>\n")
		}
	}
	builder.WriteString("  </tools>\n")
	builder.WriteString("</agent_profile>\n")
	return builder.String()
}

func estimateParameterCount(rawSchema string) int {
	trimmed := strings.TrimSpace(rawSchema)
	if trimmed == "" {
		return 0
	}
	var schema map[string]any
	if err := json.Unmarshal([]byte(trimmed), &schema); err != nil {
		return 0
	}
	rawProps, ok := schema["properties"]
	if !ok {
		return 0
	}
	props, ok := rawProps.(map[string]any)
	if !ok {
		return 0
	}
	return len(props)
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
