---
title: Instrument .NET agents
menuTitle: Instrument .NET
description: Install the Sigil .NET SDK and capture your first generation from a C# agent.
keywords:
  - Sigil
  - .NET
  - C#
  - SDK
  - instrumentation
weight: 5
---

# Instrument .NET agents

This guide shows you how to install the Sigil .NET SDK, instrument an LLM call, and verify that generation data reaches Sigil.

## Before you begin

- A running Sigil instance or Grafana Cloud stack with Sigil enabled.
- .NET 8 or later.
- Your Sigil generation export endpoint URL.

## Install the SDK

```bash
dotnet add package Grafana.Sigil
```

Provider helpers are in separate packages:

```bash
dotnet add package Grafana.Sigil.OpenAI
dotnet add package Grafana.Sigil.Anthropic
dotnet add package Grafana.Sigil.Gemini
```

## Capture a generation

```csharp
var sigil = new SigilClient(new SigilClientConfig
{
    GenerationExport = new GenerationExportConfig
    {
        Protocol = GenerationExportProtocol.Http,
        Endpoint = "<SIGIL_ENDPOINT>/api/v1/generations:export",
        Auth = new AuthConfig
        {
            Mode = ExportAuthMode.Tenant,
            TenantId = "<TENANT_ID>",
        },
    },
});

// Use provider helpers for automatic capture, for example with OpenAI:
var response = await OpenAIRecorder.CreateResponseAsync(
    sigil,
    openAIClient,
    inputItems,
    options: new OpenAISigilOptions
    {
        ConversationId = "conv-1",
        AgentName = "my-agent",
    }
);

await sigil.ShutdownAsync(CancellationToken.None);
```

Replace _SIGIL_ENDPOINT_ and _TENANT_ID_ with your values.

## Configure authentication

For Grafana Cloud, use basic auth:

```csharp
Auth = new AuthConfig
{
    Mode = ExportAuthMode.Basic,
    TenantId = "<INSTANCE_ID>",
    BasicPassword = "<API_KEY>",
}
```

## Verify data

Open the Sigil plugin in Grafana and navigate to **Conversations**. Your generation should appear within a few seconds.

## Next steps

- [Configure SDK options](../../configure/sdk/)
- [Instrument with framework integrations](../../guides/instrument-agents/)
