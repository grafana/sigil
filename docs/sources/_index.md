---
title: Grafana Sigil
description: Monitor your AI agents in production with OpenTelemetry-native observability for conversations, costs, quality, and performance.
keywords:
  - Sigil
  - AI observability
  - LLM monitoring
  - agent observability
  - OpenTelemetry
  - Grafana Cloud
weight: 1
cards:
  items:
    - title: Get started
      description: Instrument your agents and deploy Sigil to start monitoring AI workloads.
      href: get-started/
      height: 24
    - title: Configure
      description: Tune SDK, deployment, evaluation, and plugin settings.
      href: configure/
      height: 24
    - title: Guides
      description: Explore practical workflows for conversations, evaluation, dashboards, and cost optimization.
      href: guides/
      height: 24
    - title: Reference
      description: API contracts, Helm chart values, and SDK configuration reference.
      href: reference/
      height: 24
  title_class: pt-0 lh-1
hero:
  description: Open-source AI observability for teams running LLM agents in production. Monitor conversations, costs, quality, and performance from a single pane of glass.
  height: 110
  level: 1
  title: Grafana Sigil
  width: 110
---

{{< docs/hero-simple key="hero" >}}

---

{{< docs/public-preview product="Grafana Sigil" >}}

## Overview

Grafana Sigil is an open-source AI observability platform built on OpenTelemetry. It gives teams running LLM agents in production a single place to monitor agent activity, trace conversations, track costs, and evaluate quality.

Sigil provides thin SDKs for Go, Python, TypeScript, Java, and .NET that capture generation data with minimal code changes. Built-in framework integrations for LangChain, LangGraph, OpenAI Agents, Vercel AI SDK, and others make instrumentation automatic.

With the Grafana plugin, you can browse conversations, drill into traces, compare agent versions, configure online evaluation rules, and use pre-built dashboards for metrics, logs, traces, and profiles.

## Explore

{{< card-grid key="cards" type="simple" >}}
