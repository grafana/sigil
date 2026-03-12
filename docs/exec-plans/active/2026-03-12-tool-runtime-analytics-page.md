---
owner: sigil-core
status: active
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# Execution Plan: Tool Runtime Analytics Page

## Goal

Capture the recommended MVP and follow-on implementation path for a tool-specific runtime analytics page.

## Design Doc

- `docs/design-docs/2026-03-12-tool-runtime-analytics-page.md`

## Recommended MVP Scope

- hidden analytics drilldown route for one tool name
- Prometheus-backed execution, error, and latency panels for `execute_tool`
- conversation search drilldown using `tool.name = "<tool>"`
- links back to conversation explore
- reuse existing dashboard and conversation table primitives

## Deferred Scope

- first-class `/tools` browse page
- MySQL tool projection
- canonical tool-definition identity and schema history
- per-conversation tool call counts

## Checklist

- [x] Audit existing tool telemetry, query APIs, and plugin navigation.
- [x] Decide whether current Sigil data is sufficient for an MVP tool page.
- [x] Write a design doc with page scope, IA, data sources, and tradeoffs.
- [ ] Add a hidden tool drilldown route under analytics.
- [ ] Add ranked "Top tools" entry-point panels.
- [ ] Add a tool runtime page using existing dashboard and conversation browser components.
- [ ] Validate whether the MVP is enough before adding any ingest-time tool projection.

## Notes

- Current recommendation is intentionally MVP-first: do not add new Sigil storage until we prove the execution-centric page needs stable tool catalog data.
