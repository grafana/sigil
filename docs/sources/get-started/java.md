---
title: Instrument Java agents
menuTitle: Instrument Java
description: Install the Sigil Java SDK and capture your first generation from a Java agent.
keywords:
  - Sigil
  - Java
  - SDK
  - instrumentation
weight: 4
---

# Instrument Java agents

This guide shows you how to install the Sigil Java SDK, instrument an LLM call, and verify that generation data reaches Sigil.

## Before you begin

- A running Sigil instance or Grafana Cloud stack with Sigil enabled.
- Java 17 or later.
- Your Sigil generation export endpoint URL.

## Install the SDK

Add the Sigil SDK dependency to your project. For Maven:

```xml
<dependency>
    <groupId>com.grafana.sigil</groupId>
    <artifactId>sigil-sdk</artifactId>
</dependency>
```

Provider helpers and framework integrations are available as separate artifacts.

## Capture a generation

```java
SigilClient client = new SigilClient(new SigilClientConfig()
    .setGenerationExport(new GenerationExportConfig()
        .setProtocol(GenerationExportProtocol.HTTP)
        .setEndpoint("<SIGIL_ENDPOINT>/api/v1/generations:export")
        .setAuth(new AuthConfig()
            .setMode(AuthMode.TENANT)
            .setTenantId("<TENANT_ID>"))));

try {
    client.withGeneration(
        new GenerationStart()
            .setConversationId("conv-1")
            .setModel(new ModelRef()
                .setProvider("openai")
                .setName("gpt-4o")),
        recorder -> {
            recorder.setResult(new GenerationResult()
                .setOutput(List.of(
                    new Message()
                        .setRole(MessageRole.ASSISTANT)
                        .setParts(List.of(MessagePart.text("Hello from Sigil"))))));
            return null;
        }
    );
} finally {
    client.shutdown();
}
```

Replace _SIGIL_ENDPOINT_ and _TENANT_ID_ with your values.

## Use a provider helper

Provider helpers are available for OpenAI, Anthropic, and Gemini. They capture generations automatically from your LLM client calls.

## Use a framework integration

A Google ADK framework integration is available for Java.

## Configure authentication

For Grafana Cloud, use basic auth:

```java
new AuthConfig()
    .setMode(AuthMode.BASIC)
    .setTenantId("<INSTANCE_ID>")
    .setBasicPassword("<API_KEY>")
```

## Verify data

Open the Sigil plugin in Grafana and navigate to **Conversations**. Your generation should appear within a few seconds.

## Next steps

- [Configure SDK options](../../configure/sdk/)
- [Instrument with framework integrations](../../guides/instrument-agents/)
