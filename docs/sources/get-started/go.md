---
title: Instrument Go agents
menuTitle: Instrument Go
description: Install the Sigil Go SDK and capture your first generation from a Go agent.
keywords:
  - Sigil
  - Go
  - SDK
  - instrumentation
weight: 3
---

# Instrument Go agents

This guide shows you how to install the Sigil Go SDK, instrument an LLM call, and verify that generation data reaches Sigil.

## Before you begin

- A running Sigil instance or Grafana Cloud stack with Sigil enabled.
- Go 1.23 or later.
- Your Sigil generation export endpoint URL.

## Install the SDK

```bash
go get github.com/grafana/sigil/sdks/go
```

## Capture a generation

```go
package main

import (
	"context"

	"github.com/grafana/sigil/sdks/go/sigil"
)

func main() {
	cfg := sigil.DefaultConfig()
	cfg.GenerationExport.Protocol = sigil.GenerationExportProtocolHTTP
	cfg.GenerationExport.Endpoint = "<SIGIL_ENDPOINT>/api/v1/generations:export"
	cfg.GenerationExport.Auth = sigil.AuthConfig{
		Mode:     sigil.ExportAuthModeTenant,
		TenantID: "<TENANT_ID>",
	}

	client := sigil.NewClient(cfg)
	defer func() { _ = client.Shutdown(context.Background()) }()

	ctx, rec := client.StartGeneration(context.Background(), sigil.GenerationStart{
		ConversationID: "conv-1",
		Model:          sigil.ModelRef{Provider: "openai", Name: "gpt-4o"},
	})
	defer rec.End()

	_ = ctx // pass ctx to downstream calls for trace propagation

	rec.SetResult(sigil.Generation{
		Output: []sigil.Message{sigil.AssistantTextMessage("Hello from Sigil")},
	}, nil)
}
```

Replace _SIGIL_ENDPOINT_ and _TENANT_ID_ with your values.

## Use a provider helper

Provider helpers wrap LLM client calls to capture generations automatically. Helpers are available for OpenAI, Anthropic, and Gemini:

```bash
go get github.com/grafana/sigil/sdks/go-providers/openai
go get github.com/grafana/sigil/sdks/go-providers/anthropic
go get github.com/grafana/sigil/sdks/go-providers/gemini
```

## Use a framework integration

A Google ADK framework integration is available:

```bash
go get github.com/grafana/sigil/sdks/go-frameworks/google-adk
```

## Configure authentication

For Grafana Cloud, use basic auth:

```go
cfg.GenerationExport.Auth = sigil.AuthConfig{
	Mode:          sigil.ExportAuthModeBasic,
	TenantID:      "<INSTANCE_ID>",
	BasicPassword: "<API_KEY>",
}
```

## Verify data

Open the Sigil plugin in Grafana and navigate to **Conversations**. Your generation should appear within a few seconds.

## Next steps

- [Configure SDK options](../../configure/sdk/)
- [Instrument with framework integrations](../../guides/instrument-agents/)
