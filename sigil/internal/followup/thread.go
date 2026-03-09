package followup

import (
	"fmt"
	"strings"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

func buildFollowupUserPrompt(conversationLog, userMessage string) string {
	if len(conversationLog) > maxMessageCharLen {
		conversationLog = conversationLog[:maxMessageCharLen] + "\n\n[... conversation truncated ...]"
	}

	return fmt.Sprintf(`Below is the conversation so far:

<conversation>
%s
</conversation>

%s`, conversationLog, userMessage)
}

// buildConversationLog serializes all messages from the given generations
// into a readable text log, without including any system prompt (that is
// supplied separately from the target generation).
func buildConversationLog(generations []*sigilv1.Generation) string {
	var b strings.Builder
	for _, gen := range generations {
		for _, msg := range gen.GetInput() {
			writeMessage(&b, msg)
		}
		for _, msg := range gen.GetOutput() {
			writeMessage(&b, msg)
		}
	}
	return strings.TrimSpace(b.String())
}

func writeMessage(b *strings.Builder, msg *sigilv1.Message) {
	if msg == nil {
		return
	}

	role := roleLabel(msg.GetRole())
	fmt.Fprintf(b, "[%s]\n", role)

	for _, part := range msg.GetParts() {
		if text := part.GetText(); text != "" {
			b.WriteString(text)
			b.WriteString("\n")
		}
		if thinking := part.GetThinking(); thinking != "" {
			fmt.Fprintf(b, "<thinking>%s</thinking>\n", thinking)
		}
		if tc := part.GetToolCall(); tc != nil {
			fmt.Fprintf(b, "[Tool Call: %s (id: %s)]\n", tc.GetName(), tc.GetId())
			if args := tc.GetInputJson(); len(args) > 0 {
				b.WriteString(string(args))
				b.WriteString("\n")
			}
		}
		if tr := part.GetToolResult(); tr != nil {
			errLabel := ""
			if tr.GetIsError() {
				errLabel = " (ERROR)"
			}
			fmt.Fprintf(b, "[Tool Result: %s%s]\n", tr.GetName(), errLabel)
			if content := tr.GetContent(); content != "" {
				b.WriteString(content)
				b.WriteString("\n")
			}
			if cj := tr.GetContentJson(); len(cj) > 0 {
				b.WriteString(string(cj))
				b.WriteString("\n")
			}
		}
	}
	b.WriteString("\n")
}

func roleLabel(role sigilv1.MessageRole) string {
	switch role {
	case sigilv1.MessageRole_MESSAGE_ROLE_USER:
		return "User"
	case sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT:
		return "Assistant"
	case sigilv1.MessageRole_MESSAGE_ROLE_TOOL:
		return "Tool"
	default:
		return "Unknown"
	}
}
