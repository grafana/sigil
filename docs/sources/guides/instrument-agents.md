---
title: Instrument agents with frameworks
menuTitle: Instrument frameworks
description: Use Sigil framework integrations to automatically capture generations from LangChain, LangGraph, OpenAI Agents, Vercel AI SDK, and other frameworks.
keywords:
  - Sigil
  - frameworks
  - LangChain
  - LangGraph
  - OpenAI Agents
  - Vercel AI SDK
  - instrumentation
weight: 2
---

# Instrument agents with frameworks

Sigil framework integrations capture generations automatically by attaching callbacks or hooks to your agent framework. This eliminates the need to manually instrument each LLM call.

## Supported frameworks

| Framework | Python | TypeScript | Go | Java |
|-----------|--------|------------|-----|------|
| LangChain | Yes | Yes | — | — |
| LangGraph | Yes | Yes | — | — |
| OpenAI Agents | Yes | Yes | — | — |
| LlamaIndex | Yes | Yes | — | — |
| Google ADK | Yes | Yes | Yes | Yes |
| Vercel AI SDK | — | Yes | — | — |

## Set up a Python framework integration

Install the framework-specific package alongside the core SDK:

```bash
pip install sigil-sdk sigil-sdk-langchain
```

Attach the Sigil callback handler to your framework. For LangChain:

```python
from sigil_sdk import Client, ClientConfig
from sigil_sdk_langchain import SigilLangChainHandler

client = Client(ClientConfig(
    generation_export_endpoint="<SIGIL_ENDPOINT>/api/v1/generations:export",
))

handler = SigilLangChainHandler(client)

# Pass the handler to your chain or agent
chain.invoke({"input": "Hello"}, config={"callbacks": [handler]})

client.shutdown()
```

Each framework integration follows the same pattern: create a handler, pass it to your framework's callback mechanism, and the integration captures all LLM calls as generations.

## Set up a TypeScript framework integration

Import the framework sub-module:

```ts
import { SigilClient } from "@grafana/sigil-sdk-js";
import { SigilLangChainHandler } from "@grafana/sigil-sdk-js/langchain";

const client = new SigilClient({ /* config */ });
const handler = new SigilLangChainHandler(client);

// Pass the handler to your chain or agent
await chain.invoke({ input: "Hello" }, { callbacks: [handler] });

await client.shutdown();
```

## Conversation ID mapping

Framework integrations automatically map conversation IDs from framework context:

1. If the framework provides a `session_id`, `conversation_id`, or `group_id`, the integration uses it.
2. If a `thread_id` is available (LangGraph, OpenAI Agents), the integration uses it.
3. Otherwise, the integration generates a deterministic ID from the framework run context.

## Metadata

Framework integrations inject metadata into each generation:

- `sigil.framework.name` — the framework name, for example, `langchain`.
- `sigil.framework.source` — how the integration captures data.
- `sigil.framework.language` — the programming language.

Additional framework-specific metadata like `run_id`, `thread_id`, `component_name`, and `tags` is included when available.

## Next steps

- [Browse conversations](../conversations/)
- [Use the agent catalog](../agent-catalog/)
