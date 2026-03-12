---
owner: sigil-core
status: active
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# SDK Conformance Spec

Language-neutral specification of the currently shipped Sigil SDK conformance baseline.

Reference implementation: Go (`sdks/go/sigil/conformance_test.go`, `package sigil_test`).

Local entry points:

- `mise run test:sdk:conformance`
- `cd sdks/go && GOWORK=off go test ./sigil -run '^TestConformance' -count=1`

Related docs:

- Semantic conventions: `docs/references/semantic-conventions.md`
- Architecture summary: `ARCHITECTURE.md#sdk-conformance-harness`
- Design doc / future scope: `docs/design-docs/2026-03-12-sdk-conformance-harness.md`

## Current baseline

The shipped Go harness currently covers three core identity-resolution scenarios:

1. Conversation title semantics
2. User ID semantics
3. Agent identity semantics

Each scenario is executed through the public SDK API and validates the same behavior across:

- generation export payloads captured from a fake local gRPC ingest server
- OTLP spans captured with the SDK's in-memory span recorder
- OTLP metrics captured with the SDK's in-memory metric reader

The harness also provisions a fake rating HTTP server, but rating requests are not part of the active baseline yet.

## Harness requirements

Every SDK conformance runner that implements this baseline must provide:

1. A fake generation ingest receiver that captures the normalized generation payload as the backend would receive it.
2. Span capture using the SDK's local OpenTelemetry test utilities.
3. Metric capture using the SDK's local OpenTelemetry metric test utilities.
4. A client configured to target only local receivers, with no Docker or external services.
5. A flush/shutdown step before assertions so asynchronous export is complete.

## Assertion conventions

- "Assert proto metadata `X = Y`" means the captured generation payload contains metadata key `X` with string value `Y`.
- "Assert proto field `X = Y`" means the captured normalized generation payload has field `X` set to `Y`.
- "Assert span attr `X = Y`" means the captured span has attribute key `X` with value `Y`.
- "Assert span attr `X` absent" means the captured span does not contain attribute `X`.
- "Assert metric `M` has data" means the named histogram has at least one data point.
- "Assert metric `M` absent" means the named histogram is not emitted for the scenario.

## Common invariants for the current baseline

These assertions apply to every currently shipped scenario:

- Use the SDK's sync generation entry point.
- Assert `gen_ai.operation.name = "generateText"` on the generation span.
- Assert `gen_ai.client.operation.duration` has data.
- Assert `gen_ai.client.time_to_first_token` is absent.
- Shutdown the client before reading captured generation payloads.

## Scenario 1: Conversation title semantics

### Setup matrix

| Case | Start conversation title | Context conversation title | Metadata `sigil.conversation.title` | Expected resolved title |
|---|---|---|---|---|
| explicit wins | `"Explicit"` | `"Context"` | `"Meta"` | `"Explicit"` |
| context fallback | `""` | `"Context"` | absent | `"Context"` |
| metadata fallback | `""` | absent | `"Meta"` | `"Meta"` |
| whitespace omitted | `"   "` | absent | absent | absent |

### Expected behavior

- Assert span attr `sigil.conversation.title` equals the resolved title when present.
- Assert span attr `sigil.conversation.title` is absent when the resolved title is empty.
- Assert proto metadata `sigil.conversation.title` equals the resolved title when present.
- Assert proto metadata `sigil.conversation.title` is absent when the resolved title is empty.

## Scenario 2: User ID semantics

### Setup matrix

| Case | Start user ID | Context user ID | Metadata `sigil.user.id` | Metadata `user.id` | Expected resolved user ID |
|---|---|---|---|---|---|
| explicit wins | `"explicit"` | `"ctx"` | `"canonical"` | `"legacy"` | `"explicit"` |
| context fallback | `""` | `"ctx"` | absent | absent | `"ctx"` |
| canonical metadata | `""` | absent | `"canonical"` | absent | `"canonical"` |
| legacy metadata | `""` | absent | absent | `"legacy"` | `"legacy"` |
| canonical beats legacy | `""` | absent | `"canonical"` | `"legacy"` | `"canonical"` |
| whitespace trimmed | `"  padded  "` | absent | absent | absent | `"padded"` |

### Expected behavior

- Assert span attr `user.id` equals the resolved user ID.
- Assert proto metadata `sigil.user.id` equals the resolved user ID.

## Scenario 3: Agent identity semantics

### Setup matrix

| Case | Start agent name | Start agent version | Context agent name | Context agent version | Result agent name | Result agent version | Expected name | Expected version |
|---|---|---|---|---|---|---|---|---|
| explicit fields | `"agent-explicit"` | `"v1.2.3"` | absent | absent | absent | absent | `"agent-explicit"` | `"v1.2.3"` |
| context fallback | `""` | `""` | `"agent-context"` | `"v-context"` | absent | absent | `"agent-context"` | `"v-context"` |
| result-time override | `"agent-seed"` | `"v-seed"` | absent | absent | `"agent-result"` | `"v-result"` | `"agent-result"` | `"v-result"` |
| empty omission | `""` | `""` | absent | absent | absent | absent | absent | absent |

### Expected behavior

- Assert span attr `gen_ai.agent.name` equals the resolved name when present.
- Assert span attr `gen_ai.agent.name` is absent when the resolved name is empty.
- Assert span attr `gen_ai.agent.version` equals the resolved version when present.
- Assert span attr `gen_ai.agent.version` is absent when the resolved version is empty.
- Assert proto field `agent_name` equals the resolved name when present, otherwise empty.
- Assert proto field `agent_version` equals the resolved version when present, otherwise empty.

## Extending the spec

Future phases will extend this document with additional core, provider-wrapper, and framework-adapter scenarios. Until those phases land, this document is the authoritative baseline for the currently shipped Go conformance harness.
