# Claude Agent SDK Wrapper (`@grafana/sigil-sdk-js/claude-agent-sdk`)

Use the Claude Agent SDK wrapper to instrument `query()` streams with Sigil generation export, tool execution spans, and streaming TTFT.

## Install

```bash
pnpm add @grafana/sigil-sdk-js @anthropic-ai/claude-agent-sdk
```

## Quickstart

Wrap the Claude output stream directly:

```ts
import { SigilClient } from '@grafana/sigil-sdk-js';
import { withSigilClaudeAgentSdk } from '@grafana/sigil-sdk-js/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

const client = new SigilClient();

const { stream } = withSigilClaudeAgentSdk(
  query({
    prompt: 'Summarize the latest failing deployment.',
  }),
  client,
  {
    agentName: 'release-agent',
    systemPrompt: 'Be concise and include rollback risk.',
  }
);

for await (const message of stream) {
  // consume Claude Agent SDK messages unchanged
}
```

## Streaming prompt interception

For streaming prompt generators, intercept the prompt input as well so Sigil can capture user/tool messages before the assistant turn:

```ts
import {
  SigilClaudeAgentSdkHandler,
  interceptPrompt,
  withSigilClaudeAgentSdk,
} from '@grafana/sigil-sdk-js/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

const handler = new SigilClaudeAgentSdkHandler(client, {
  conversationId: 'session-42',
  captureInputs: true,
});

const prompt = interceptPrompt(myPromptGenerator(), handler);
const { stream } = withSigilClaudeAgentSdk(query({ prompt }), client, { handler });
```

`interceptPrompt(...)` preserves the original prompt stream while recording user text and `tool_result` messages for the next generation input.

## Conversation mapping

Primary mapping is Claude session identity:

1. explicit `conversationId` option
2. message `session_id`
3. session id captured from `system.init`

Use the `conversationId` option when you want to group multiple Claude sessions under a shared DAG or workflow run.

## Behavior

- Generations are recorded in explicit `STREAM` mode.
- TTFT is captured from the first streamed text delta.
- Tool executions inherit the assistant request model/provider when tool calls are emitted.
- Tool-result user messages are preserved as tool-role generation input for the next assistant turn.

Tags:

- `sigil.framework.name=claude-agent-sdk`
- `sigil.framework.source=handler`
- `sigil.framework.language=javascript`

## Privacy controls

```ts
const { stream } = withSigilClaudeAgentSdk(source, client, {
  captureInputs: false,
  captureOutputs: false,
});
```

- `captureInputs=false`: omit user/tool input messages
- `captureOutputs=false`: omit assistant output payloads

## Troubleshooting

- Missing system prompt:
  - The Claude Agent SDK does not replay it in the output stream. Pass `systemPrompt` explicitly if you want it recorded.
- Single-message prompts missing from input capture:
  - Use `initialPrompt` for one-shot calls, or `interceptPrompt(...)` for generator prompts.
- Missing exports on shutdown:
  - Call `await client.shutdown()` before process exit.
