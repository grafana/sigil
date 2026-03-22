---
title: Instrument Python agents
menuTitle: Instrument Python
description: Install the Sigil Python SDK and capture your first generation from a Python agent.
keywords:
  - Sigil
  - Python
  - SDK
  - instrumentation
weight: 1
---

# Instrument Python agents

This guide shows you how to install the Sigil Python SDK, instrument an LLM call, and verify that generation data reaches Sigil.

## Before you begin

- A running Sigil instance or Grafana Cloud stack with Sigil enabled.
- Python 3.9 or later.
- Your Sigil generation export endpoint URL.

## Install the SDK

```bash
pip install sigil-sdk
```

To use a provider helper, install the corresponding package:

```bash
pip install sigil-sdk-openai
pip install sigil-sdk-anthropic
pip install sigil-sdk-gemini
```

## Use a framework integration

If you use LangChain, LangGraph, OpenAI Agents, LlamaIndex, or Google ADK, install the corresponding framework package for automatic generation capture:

```bash
pip install sigil-sdk-langchain
pip install sigil-sdk-langgraph
pip install sigil-sdk-openai-agents
pip install sigil-sdk-llamaindex
pip install sigil-sdk-google-adk
```

Framework integrations inject callbacks that capture generations automatically. Refer to [Instrument agents with frameworks](../../guides/instrument-agents/) for setup details.

## Capture a generation manually

To instrument calls without a framework, use the context manager:

```python
from sigil_sdk import Client, ClientConfig, GenerationStart, ModelRef, assistant_text_message

client = Client(
    ClientConfig(
        generation_export_endpoint="<SIGIL_ENDPOINT>/api/v1/generations:export",
    )
)

with client.start_generation(
    GenerationStart(
        conversation_id="conv-1",
        model=ModelRef(provider="openai", name="gpt-4o"),
    )
) as rec:
    rec.set_result(output=[assistant_text_message("Hello from Sigil")])

client.shutdown()
```

Replace _SIGIL_ENDPOINT_ with your Sigil API address.

## Use a provider helper

Provider helpers capture generations automatically from your LLM client calls. For example, with OpenAI:

```python
import openai
from sigil_sdk import Client, ClientConfig
from sigil_sdk_openai import chat

sigil = Client(
    ClientConfig(
        generation_export_endpoint="<SIGIL_ENDPOINT>/api/v1/generations:export",
    )
)
openai_client = openai.OpenAI()

response = chat.completions.create(
    sigil,
    openai_client,
    {"model": "gpt-4o", "messages": [{"role": "user", "content": "What is observability?"}]},
)

sigil.shutdown()
```

## Configure authentication

For Grafana Cloud, use basic auth:

```python
from sigil_sdk import Client, ClientConfig
from sigil_sdk.config import GenerationExportConfig, AuthConfig

client = Client(
    ClientConfig(
        generation_export=GenerationExportConfig(
            protocol="http",
            endpoint="<SIGIL_ENDPOINT>/api/v1/generations:export",
            auth=AuthConfig(
                mode="basic",
                tenant_id="<INSTANCE_ID>",
                basic_password="<API_KEY>",
            ),
        ),
    )
)
```

For self-hosted with tenant mode:

```python
client = Client(
    ClientConfig(
        generation_export=GenerationExportConfig(
            protocol="http",
            endpoint="<SIGIL_ENDPOINT>/api/v1/generations:export",
            auth=AuthConfig(
                mode="tenant",
                tenant_id="<TENANT_ID>",
            ),
        ),
    )
)
```

## Verify data

Open the Sigil plugin in Grafana and navigate to **Conversations**. Your generation should appear within a few seconds.

## Next steps

- [Configure SDK options](../../configure/sdk/)
- [Browse conversations](../../guides/conversations/)
