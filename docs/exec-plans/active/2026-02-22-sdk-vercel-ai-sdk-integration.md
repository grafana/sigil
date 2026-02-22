---
owner: sigil-core
status: active
last_reviewed: 2026-02-22
source_of_truth: true
audience: both
---

# SDK Integrations Delivery: Vercel AI SDK (TypeScript)

## Goal

Deliver first-class Vercel AI SDK TypeScript integration with conversation-first generation export, Sigil-native spans/metrics, robust tool lifecycle mapping, and optional AI SDK telemetry enrichment.

## Source design doc

- `docs/design-docs/2026-02-22-sdk-vercel-ai-sdk-integration.md`

## Completion policy

- A checkbox moves to `[x]` only when code/tests/docs for that item are complete in the working branch.
- Checklist status is updated in-branch as implementation progresses.
- When all exit criteria are met, move this plan to `docs/exec-plans/completed/`.

## Scope

- TypeScript integration for Vercel AI SDK in `sdks/js`.
- Middleware-first instrumentation with optional convenience wrapper helpers.
- `generateText` and `streamText` lifecycle coverage.
- Tool lifecycle spans and generation mapping where framework signals are available.
- Optional AI SDK telemetry bridge that enriches traces without replacing Sigil generation export.
- Docs, tests, and quality task updates required for durable delivery.

## Out of scope

- Python/Go/Java AI SDK integration modules.
- Sigil ingest/query schema changes.
- Plugin UI feature work specific to this framework.

## Track A: API and contract lock

- [ ] Confirm and pin supported AI SDK major/minor version for this integration.
- [ ] Lock middleware callback/hook surfaces to avoid relying on unstable internals.
- [ ] Document stable field extraction rules for usage, finish reason, and tool signals.
- [ ] Record version compatibility notes in framework docs.

## Track B: JS framework module scaffolding

- [ ] Create `sdks/js/src/frameworks/vercel-ai-sdk/` module structure.
- [ ] Add options/types module and explicit exported type contracts.
- [ ] Add shared correlation utilities for generation/tool run ids.
- [ ] Add package subpath export `@grafana/sigil-sdk-js/vercel-ai-sdk`.

## Track C: Sigil-native lifecycle mapping

- [ ] Implement `generateText` mapping to Sigil generation/span/metrics lifecycle.
- [ ] Implement `streamText` mapping with chunk aggregation and TTFT capture.
- [ ] Implement deterministic conversation id precedence and fallback behavior.
- [ ] Implement framework metadata mapping (`sigil.framework.*`) and bounded normalization.
- [ ] Ensure trace-generation linkage is preserved (`trace_id`/`span_id` correlation).

## Track D: Tool lifecycle and error handling

- [ ] Map tool start/end/error events to tool spans and generation attributes.
- [ ] Add stable fallback tool run ids for id-less callbacks and persist lookup until closure.
- [ ] Enforce atomic de-duplication for duplicate/concurrent lifecycle callbacks.
- [ ] Ensure all end/error/abort paths close recorder state exactly once.

## Track E: Optional AI SDK telemetry bridge

- [ ] Add helper to generate/merge `experimental_telemetry` settings.
- [ ] Align telemetry `recordInputs`/`recordOutputs` with Sigil capture toggles.
- [ ] Inject optional Sigil correlation metadata into telemetry metadata.
- [ ] Verify telemetry bridge is additive and does not alter generation correctness.

## Track F: Documentation and examples

- [ ] Add framework guide: `sdks/js/docs/frameworks/vercel-ai-sdk.md`.
- [ ] Add quickstart snippet (one-liner wrapper path).
- [ ] Add middleware-first snippet (idiomatic advanced path).
- [ ] Add streaming + tool-call snippet.
- [ ] Add conversation id mapping/custom resolver snippet.
- [ ] Add capture/privacy and telemetry hybrid mode snippets.
- [ ] Add troubleshooting section for missing usage, id-less events, and duplicate callbacks.

## Track G: Tests and quality wiring

- [ ] Add unit tests for mapping/utilities and metadata normalization.
- [ ] Add integration-style tests for `generateText` success/error flows.
- [ ] Add integration-style tests for `streamText` success/error/abort flows.
- [ ] Add regression tests for id-less generation/tool event correlation.
- [ ] Add tests for `captureInputs=false` and `captureOutputs=false` including tool payloads.
- [ ] Add tests for usage extraction variants and finish reason mapping.
- [ ] Add tests ensuring trace-generation correlation fields are exported.
- [ ] Add hybrid telemetry tests (telemetry on/off parity for generation export).
- [ ] Update `mise` tasks and JS test command docs for new framework module.

## Track H: Governance and index sync

- [ ] Update `docs/index.md` links once implementation docs exist.
- [ ] Update `docs/design-docs/index.md` status when implementation completes.
- [ ] Update `ARCHITECTURE.md` if framework contract text changes.
- [ ] Keep this plan checklist synchronized as work lands.

## Required tests

- Lifecycle mapping:
  - `generateText`: start/end/error
  - `streamText`: start/chunks/finish/error/abort
- Mapping fidelity:
  - conversation id precedence and deterministic fallback
  - framework metadata field names and values
  - token usage and finish reason extraction
- Tool coverage:
  - start/end/error mapping
  - id-less callback fallback correlation
- Capture controls:
  - model input/output capture toggles
  - tool argument/result capture toggles
- Reliability:
  - concurrent duplicate callback deduplication
  - recorder closure and leak prevention
- Hybrid mode:
  - telemetry bridge enabled/disabled behavior parity for generation export

## Validation commands (target)

- `mise run typecheck:ts:sdk-js`
- `mise run test:ts:sdk-js`
- framework-specific JS test commands introduced by this work

## Risks

- AI SDK event payload changes between versions can break field extraction.
- Incomplete id correlation can orphan runs/spans in streaming/tool-heavy flows.
- Telemetry + Sigil dual instrumentation can duplicate traces if boundary is unclear.
- High-cardinality metadata can degrade queryability without normalization guardrails.

## Exit criteria

- Framework module implemented and exported under `@grafana/sigil-sdk-js/vercel-ai-sdk`.
- `generateText` and `streamText` lifecycles map correctly with deterministic conversation identity.
- Tool spans and generation attributes are emitted and closed correctly in success/error/id-less flows.
- Capture toggles are respected for both model and tool payloads.
- Docs include quickstart, idiomatic middleware usage, streaming/tools, conversation mapping, and telemetry hybrid guidance.
- Test coverage and quality commands pass for the new integration.

## Explicit assumptions and defaults

- TypeScript-only scope for Vercel AI SDK in this plan.
- Sigil generation export remains source of truth.
- AI SDK telemetry is optional and additive.
- `conversation_id` is primary identity; lineage ids remain optional supporting metadata.
