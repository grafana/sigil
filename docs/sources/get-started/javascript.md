---
title: Instrument TypeScript and JavaScript agents
menuTitle: Instrument JavaScript
description: Install the Sigil JavaScript SDK and capture your first generation from a TypeScript or JavaScript agent.
keywords:
  - Sigil
  - TypeScript
  - JavaScript
  - SDK
  - instrumentation
weight: 2
---

# Instrument TypeScript and JavaScript agents

This guide shows you how to install the Sigil JavaScript SDK, instrument an LLM call, and verify that generation data reaches Sigil.

## Before you begin

- A running Sigil instance or Grafana Cloud stack with Sigil enabled.
- Node.js 22 or later.
- Your Sigil generation export endpoint URL.

## Install the SDK

```bash
npm install @grafana/sigil-sdk-js
```

## Use a framework integration

If you use LangChain, LangGraph, OpenAI Agents, LlamaIndex, Google ADK, or Vercel AI SDK, import the framework sub-module for automatic generation capture:

- `@grafana/sigil-sdk-js/langchain`
- `@grafana/sigil-sdk-js/langgraph`
- `@grafana/sigil-sdk-js/openai-agents`
- `@grafana/sigil-sdk-js/llamaindex`
- `@grafana/sigil-sdk-js/google-adk`
- `@grafana/sigil-sdk-js/vercel-ai-sdk`

Each integration attaches callbacks or hooks that capture generations automatically. Refer to [Instrument agents with frameworks](../../guides/instrument-agents/) for setup details.

## Capture a generation manually

To instrument calls without a framework:

```ts
import { SigilClient } from "@grafana/sigil-sdk-js";

const client = new SigilClient({
  generationExport: {
    protocol: "http",
    endpoint: "<SIGIL_ENDPOINT>/api/v1/generations:export",
    auth: { mode: "tenant", tenantId: "<TENANT_ID>" },
  },
});

await client.startGeneration(
  {
    conversationId: "conv-1",
    model: { provider: "openai", name: "gpt-4o" },
  },
  async (recorder) => {
    recorder.setResult({
      output: [{ role: "assistant", content: "Hello from Sigil" }],
    });
  }
);

await client.shutdown();
```

Replace _SIGIL_ENDPOINT_ and _TENANT_ID_ with your values.

## Use a provider helper

The SDK includes helpers for OpenAI, Anthropic, and Gemini. For example, with OpenAI:

```ts
import { SigilClient, openai } from "@grafana/sigil-sdk-js";

const sigil = new SigilClient({ /* config */ });

const response = await openai.chat.completions.create(
  sigil,
  openaiClient,
  { model: "gpt-4o", messages: [{ role: "user", content: "What is observability?" }] },
);

await sigil.shutdown();
```

## Configure authentication

For Grafana Cloud:

```ts
const client = new SigilClient({
  generationExport: {
    protocol: "http",
    endpoint: "<SIGIL_ENDPOINT>/api/v1/generations:export",
    auth: {
      mode: "basic",
      tenantId: "<INSTANCE_ID>",
      basicPassword: "<API_KEY>",
    },
  },
});
```

## Verify data

Open the Sigil plugin in Grafana and navigate to **Conversations**. Your generation should appear within a few seconds.

## Next steps

- [Configure SDK options](../../configure/sdk/)
- [Browse conversations](../../guides/conversations/)
