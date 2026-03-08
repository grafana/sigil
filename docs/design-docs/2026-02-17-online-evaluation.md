---
owner: sigil-core
status: completed
last_reviewed: 2026-03-07
source_of_truth: true
audience: both
---

# Online Evaluation (Live Scoring)

## Summary

Online evaluation adds configurable, asynchronous scoring to Sigil. Evaluators run on production generations and attach scores back to the generation + conversation debugging workflow in the Grafana app plugin.

Key design choices:

- **Immediate per-generation trigger.** Each eligible generation is evaluated as it is ingested. No idle windows, no session-completion detection, no Tempo dependency. Market standard (Langfuse, Braintrust).
- **API-managed configuration.** Evaluators, rules, and tenant templates are stored in MySQL and managed via CRUD APIs. Predefined evaluator defaults ship with Sigil in code. Optional YAML seed for first-boot bootstrap.
- **Predefined evaluator library.** Ready-to-use LLM-as-judge templates for helpfulness, toxicity, PII, groundedness, relevance, conciseness, and format adherence, plus heuristic evaluators for JSON validation, empty-response, and length checks.
- **Conversation-level sampling.** Hash on `(conversation_id, rule_id)` so all eligible turns in a sampled conversation get evaluated.
- **Bring-your-own evaluator.** Score export API (`POST /api/v1/scores:export`) lets users run evaluations in their own infra and push results back.

This doc covers online evaluation only. Offline evaluation (datasets, experiments, CI gates) is covered separately.

## Problem Statement

Sigil already answers "what happened?" (trace + generation payload), "where did it break?" (errors, tool timeline), "what did the user think?" (ratings), and "what did the operator decide?" (annotations).

It does not answer the next operator question at production scale:

- "Is quality drifting?"
- "Did a rollout regress helpfulness / format / safety?"
- "Which cohorts are getting worse (model / agent / version)?"

Online evaluation provides continuous, quantitative signals without becoming a separate platform.

## Goals

- Score generations asynchronously with configurable evaluators.
- Ship a predefined evaluator library that works out of the box.
- Make scoring cheap to operate: filters + sampling + rate limits + concurrency caps.
- Keep evaluation debuggable: score -> generation -> trace linkage is first-class.
- Support two execution modes: built-in evaluators inside Sigil workers, and external scores via API.
- Provide API-managed configuration for evaluators and rules.

## Non-Goals (v1)

- Guardrails (request-path blocking / routing / transform).
- Full prompt CMS / prompt registry.
- Code sandbox runtime for user-uploaded evaluator code.
- Step/trajectory evaluation (requires richer span context).
- Session/conversation-level evaluation (requires completion detection; see Known Gaps).

## Definitions

- **Evaluator**: a function that produces one or more scores for a target.
- **Online rule**: binds an evaluator to production traffic via filters + sampling.
- **Score**: a typed result attached to a target with provenance.
- **Target** (v1): generation-scoped (`generation_id`), with optional `conversation_id`, `trace_id`, `span_id` for drilldown.
- **Turn**: one user request and the model response shown to the user. A turn may include multiple generations (planner, tool calls, final answer). The `user_visible_turn` selector targets the final-answer generation.

Scores are distinct from ratings (end-user feedback) and annotations (operator workflow notes).

## Trigger Model

### Per-Generation, Immediate, at Ingest Time

At ingest time, after `SaveBatch` succeeds in the WAL store:

1. Persist generation rows and enqueue events atomically in MySQL (`generations` + `eval_enqueue_events` in one transaction).
2. A dedicated enqueue dispatcher claims durable enqueue events.
3. The dispatcher loads active rules, evaluates selector + filter + conversation sampling, and inserts matching work items into `eval_work_items`.
4. The eval worker picks work items asynchronously and writes scores.

This removes the lossy "best-effort enqueue in request hook" behavior: if ingest commits, enqueue intent is durable and retried.

### Why Not Session/Turn-Boundary Detection?

Neither Langfuse nor Braintrust attempt to detect when a session or conversation is "complete." Both evaluate individual observations/spans as they arrive. Langfuse explicitly documents: "LLM-as-a-Judge evaluators cannot be applied directly to sessions, as Langfuse does not inherently know when a session has concluded."

The `user_visible_turn` selector already targets the right generation: the one with assistant text and no tool-call parts. This is the generation shown to the user. Its input contains the full conversation history (system prompt + all previous messages), so the evaluator has full turn context without needing to wait for session completion.

### Late Additions to a Conversation

If a user adds to a conversation hours or days later, the new eligible generation triggers a new independent evaluation with the full updated history in its input. Previous evaluations remain valid for their respective turns.

## Evaluator Taxonomy

### Built-in Evaluator Kinds

**`llm_judge`**: Prompt template + judge model config. Returns numeric score (0-1) with explanation. Strict timeouts and token limits. Stable prompt hashing for reproducibility.

`llm_judge` prompt context is derived from the normalized `Generation` payload rather than a single lossy flattened blob. The primary authoring surface is developer-facing:

- `latest_user_message`
- `user_history`
- `assistant_response`
- `assistant_thinking`
- `assistant_sequence`
- `tool_calls`
- `tool_results`
- `tools`
- `stop_reason`
- `system_prompt`
- `call_error`

Compatibility aliases remain available:

- `input` -> `latest_user_message`
- `output` -> `assistant_response`
- `error` -> `call_error`

Rendering rules:

- simple variables render as plain text
- structured variables render as compact tagged text fragments
- empty variables render as empty string
- `tools` renders a compact tool inventory with schema summaries rather than full schema bodies

This keeps prompts composable inside user-authored prose while still exposing mixed-block agent behavior and tool context when evaluators need it.

Supported judge providers (v1):

| Provider | SDK | Direct Auth | CSP Variant | CSP Auth |
|---|---|---|---|---|
| OpenAI | `openai-go` | `SIGIL_EVAL_OPENAI_API_KEY` | Azure OpenAI | `SIGIL_EVAL_AZURE_OPENAI_ENDPOINT` + `SIGIL_EVAL_AZURE_OPENAI_API_KEY` (or Azure AD) |
| Anthropic | `anthropic-sdk-go` | `SIGIL_EVAL_ANTHROPIC_API_KEY` or `SIGIL_EVAL_ANTHROPIC_AUTH_TOKEN` | AWS Bedrock | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_REGION` (or IAM role), optional Bedrock bearer token |
| Anthropic | `anthropic-sdk-go` | `SIGIL_EVAL_ANTHROPIC_API_KEY` or `SIGIL_EVAL_ANTHROPIC_AUTH_TOKEN` | Anthropic Vertex | `SIGIL_EVAL_ANTHROPIC_VERTEX_PROJECT` + ADC or explicit credentials file/json |
| Google | `google.golang.org/genai` | `SIGIL_EVAL_GOOGLE_API_KEY` | Vertex AI | `SIGIL_EVAL_VERTEXAI_PROJECT` + ADC or explicit credentials file/json |
| OpenAI-compatible | HTTP compatibility adapter | `SIGIL_EVAL_OPENAI_COMPAT_API_KEY` + `SIGIL_EVAL_OPENAI_COMPAT_BASE_URL` | -- | -- |

The first three use official provider SDKs (same pattern as charmbracelet/crush). SDKs handle auth, retries, error types, and CSP-specific signing (SigV4 for Bedrock, OAuth2 for Vertex AI, Azure AD for Azure OpenAI).

Provider discovery is explicitly enabled per provider (`SIGIL_EVAL_*_ENABLED`) and only reports providers that initialize successfully with valid credentials.

The **OpenAI-compatible** provider uses a lightweight HTTP compatibility adapter with a custom base URL, covering local models (Ollama, vLLM, LM Studio), proxy gateways (LiteLLM, OpenRouter), and any endpoint that speaks the OpenAI Chat Completions API. Multiple OpenAI-compatible providers can be registered via indexed env vars (`SIGIL_EVAL_OPENAI_COMPAT_1_BASE_URL`, `SIGIL_EVAL_OPENAI_COMPAT_1_API_KEY`, `SIGIL_EVAL_OPENAI_COMPAT_1_NAME`) or via the control plane API.

Each provider is wrapped behind a common `JudgeClient` interface in `sigil/internal/eval/evaluators/judges/`:

```go
type JudgeClient interface {
    Judge(ctx context.Context, req JudgeRequest) (JudgeResponse, error)
    ListModels(ctx context.Context) ([]JudgeModel, error)
}

type JudgeRequest struct {
    SystemPrompt string
    UserPrompt   string
    Model        string
    MaxTokens    int
    Temperature  float64
}

type JudgeResponse struct {
    Text      string
    Model     string
    LatencyMs int64
    Usage     JudgeUsage
}

type JudgeModel struct {
    ID            string
    Name          string
    Provider      string
    ContextWindow int
}
```

Provider resolution: evaluator config specifies `provider` + `model`. The `provider` field supports direct providers, CSP variants, and OpenAI-compatible endpoints (e.g., `openai`, `azure`, `anthropic`, `bedrock`, `google`, `vertexai`, `openai-compat`, or a named custom provider like `ollama`). Provider is resolved to the corresponding `JudgeClient` at worker startup. Credentials are read from environment variables or the control plane -- never stored in evaluator definition objects.

Default judge model (used by predefined templates): configurable via `SIGIL_EVAL_DEFAULT_JUDGE_MODEL` (default `openai/gpt-4o-mini`). Format: `provider/model_name`.

### Judge Model Discovery API

The UI needs to know which judge providers are configured and what models are available. These endpoints are part of the control plane:

- `GET /api/v1/eval/judge/providers` -- list configured judge providers (only those with valid credentials).
- `GET /api/v1/eval/judge/models?provider={id}` -- list available models for a provider.

Response includes provider ID, display name, CSP variant indicator, and per-model metadata (ID, name, context window). This enables the UI to build model selector dropdowns for evaluator configuration.

**`json_schema`**: Validates that response text is valid JSON matching a provided JSON Schema. Returns bool (valid/invalid). No external call needed.

**`regex`**: Matches or rejects regex patterns against response text. Returns bool. No external call needed.

**`heuristic`**: Simple deterministic checks: length bounds, empty response, contains/not-contains keywords. Returns bool or numeric. No external call needed.

### External Scores via API

`POST /api/v1/scores:export` lets users run evaluations in their own infrastructure and report results back. This covers the same use case as Langfuse "custom scores via SDK" and Braintrust "code-based scorers" without requiring a sandbox runtime.

### Predefined Evaluator Library

Sigil ships ready-to-use evaluator templates exposed through control-plane template APIs. Templates are not auto-inserted into tenant evaluator tables; users fork a template into a tenant evaluator before attaching it to rules.

**LLM-as-Judge templates:**

| ID | Description | Output Type |
|---|---|---|
| `sigil.helpfulness` | How helpful and complete is the response for the user request? | numeric 1-10 |
| `sigil.toxicity` | Does the response contain toxic, harmful, or offensive content? | bool |
| `sigil.pii` | Does the response contain personally identifiable information? | bool |
| `sigil.groundedness` | How well does the response stay grounded in the request and available context? | numeric 1-10 |
| `sigil.relevance` | How relevant is the response to the user's input? | numeric 1-10 |
| `sigil.conciseness` | How concise is the response without losing needed information? | numeric 1-10 |
| `sigil.format_adherence` | Does the response follow the requested output format? | bool |

**Heuristic templates:**

| ID | Description | Output Type |
|---|---|---|
| `sigil.json_valid` | Is the response valid JSON? | bool |
| `sigil.response_not_empty` | Is the response non-empty? | bool |
| `sigil.response_length` | Is the response within configurable length bounds? | bool |

Each predefined template includes prompt text (for LLM-judge), default output keys, and baseline evaluator config. Forked evaluators can override any field (including judge provider/model) before use in rules.

## Core Objects

### Score (atomic output)

Scores are append-only. New truth is a new score record.

```json
{
  "score_id": "sc_01K...",
  "created_at": "2026-02-17T10:00:00Z",
  "tenant_id": "t-1",
  "target": {
    "type": "generation",
    "generation_id": "gen_01K...",
    "conversation_id": "conv-123",
    "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    "span_id": "00f067aa0ba902b7"
  },
  "evaluator": {
    "id": "sigil.helpfulness",
    "version": "2026-02-17",
    "kind": "llm_judge"
  },
  "key": "helpfulness",
  "value": { "number": 0.78 },
  "unit": "score_0_1",
  "passed": true,
  "explanation": "Concise but missed constraints.",
  "metadata": {
    "judge_model": "openai/gpt-4o-mini",
    "judge_latency_ms": 623
  },
  "source": {
    "kind": "online_rule",
    "id": "online.helpfulness.user_visible",
    "run_id": "run_01K..."
  }
}
```

- `key`: stable metric name (e.g., `helpfulness`, `json.valid`, `policy.safe`).
- `value`: oneof `number` (recommended), `bool` (pass/fail), `string` (categorical).
- `passed`: optional; for numeric scores computed from pass threshold. Stored for query convenience.
- `source`: provenance -- what rule or external system produced this score.

### Evaluator Definition

Stored in `eval_evaluators` table. Includes kind, config (prompt, schema, patterns), output key definitions, and version. Predefined templates are marked with `is_predefined = true`.

### Online Rule

Stored in `eval_rules` table. Binds evaluators to traffic via:

- `selector`: which generations are eligible (`user_visible_turn`, `all_assistant_generations`, `tool_call_steps`, `errored_generations`).
- `match`: filter over generation attributes.
- `sample_rate`: conversation-level sampling percentage.
- `evaluator_ids`: list of evaluator references to run.
- `enabled`: toggle.

## Storage Design (MySQL)

### `generation_scores` (append-only score events)

```sql
CREATE TABLE generation_scores (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  score_id VARCHAR(128) NOT NULL,
  generation_id VARCHAR(255) NOT NULL,
  conversation_id VARCHAR(255) NULL,
  trace_id VARCHAR(64) NULL,
  span_id VARCHAR(16) NULL,
  evaluator_id VARCHAR(255) NOT NULL,
  evaluator_version VARCHAR(64) NOT NULL,
  rule_id VARCHAR(255) NULL,
  run_id VARCHAR(255) NULL,
  score_key VARCHAR(255) NOT NULL,
  score_type VARCHAR(16) NOT NULL,
  score_number DOUBLE NULL,
  score_bool BOOLEAN NULL,
  score_string VARCHAR(255) NULL,
  unit VARCHAR(64) NULL,
  passed BOOLEAN NULL,
  explanation TEXT NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  ingested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY ux_generation_scores_tenant_score (tenant_id, score_id),
  KEY idx_generation_scores_tenant_generation_time (tenant_id, generation_id, created_at),
  KEY idx_generation_scores_tenant_rule_time (tenant_id, rule_id, created_at),
  KEY idx_generation_scores_tenant_key_time (tenant_id, score_key, created_at),
  KEY idx_generation_scores_tenant_pass_time (tenant_id, passed, created_at)
);
```

### `eval_work_items` (work queue)

```sql
CREATE TABLE eval_work_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  work_id VARCHAR(128) NOT NULL,
  generation_id VARCHAR(255) NOT NULL,
  evaluator_id VARCHAR(255) NOT NULL,
  evaluator_version VARCHAR(64) NOT NULL,
  rule_id VARCHAR(255) NOT NULL,
  scheduled_at DATETIME(6) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL,
  last_error TEXT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY ux_eval_work_items_tenant_work (tenant_id, work_id),
  KEY idx_eval_work_items_tenant_status_scheduled (tenant_id, status, scheduled_at)
);
```

### `eval_evaluators` (evaluator definitions)

```sql
CREATE TABLE eval_evaluators (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  evaluator_id VARCHAR(255) NOT NULL,
  version VARCHAR(64) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  config_json JSON NOT NULL,
  output_keys_json JSON NOT NULL,
  is_predefined BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY ux_eval_evaluators_tenant_id_version (tenant_id, evaluator_id, version)
);
```

### `eval_rules` (online rules)

```sql
CREATE TABLE eval_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  rule_id VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  selector VARCHAR(64) NOT NULL DEFAULT 'user_visible_turn',
  match_json JSON NOT NULL,
  sample_rate DOUBLE NOT NULL DEFAULT 0.01,
  evaluator_ids_json JSON NOT NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY ux_eval_rules_tenant_id (tenant_id, rule_id)
);
```

## Control Plane APIs

### Evaluators

- `POST /api/v1/eval/evaluators` -- create or update evaluator definition.
- `GET /api/v1/eval/evaluators` -- list evaluators (paginated, tenant-scoped).
- `GET /api/v1/eval/evaluators/{id}` -- get evaluator detail.
- `DELETE /api/v1/eval/evaluators/{id}` -- soft-delete evaluator.

### Predefined Templates

- `GET /api/v1/eval/predefined/evaluators` -- list predefined evaluator templates.
- `POST /api/v1/eval/predefined/evaluators/{id}:fork` -- create a tenant evaluator from a predefined template with optional config/output overrides.

### Rules

- `POST /api/v1/eval/rules` -- create or update online rule.
- `GET /api/v1/eval/rules` -- list rules (paginated, tenant-scoped).
- `GET /api/v1/eval/rules/{id}` -- get rule detail.
- `PATCH /api/v1/eval/rules/{id}` -- enable/disable rule.
- `DELETE /api/v1/eval/rules/{id}` -- soft-delete rule.

### Judge Model Discovery

- `GET /api/v1/eval/judge/providers` -- list configured judge providers with status.
- `GET /api/v1/eval/judge/models?provider={id}` -- list available models for a provider.

These endpoints enable the UI to populate model selector dropdowns when users create or edit evaluators. Only providers with valid credentials are returned. Each provider reports its type (direct or CSP variant), and each model includes ID, display name, and context window.

## Score APIs

### Export Scores (bring-your-own evaluator)

`POST /api/v1/scores:export`

```json
{
  "scores": [
    {
      "score_id": "sc_01K...",
      "generation_id": "gen_01K...",
      "conversation_id": "conv-123",
      "trace_id": "...",
      "span_id": "...",
      "evaluator_id": "my-company.policy.v1",
      "evaluator_version": "1.2.3",
      "score_key": "policy.safe",
      "value": { "bool": true },
      "passed": true,
      "explanation": "No policy violation detected",
      "metadata": { "runtime_ms": 12 },
      "created_at": "2026-02-17T10:00:00Z",
      "source": { "kind": "sdk", "id": "my-service" }
    }
  ]
}
```

Response mirrors generation ingest style: per-item acceptance with deterministic errors.

### Query Scores

- `GET /api/v1/generations/{generation_id}/scores?limit=50&cursor=...` -- paginated scores for a generation.
- Generation detail response (`GET /api/v1/generations/{id}`) includes `latest_scores` summary.

## Configuration Model

### API-Primary

Evaluators and rules are stored in MySQL and managed via the control plane APIs. This is the primary configuration path.

### YAML Seed (Optional Bootstrap)

On first boot, if `sigil-eval-seed.yaml` exists, Sigil loads it and inserts evaluators + rules into the DB. After that, the DB is the source of truth for tenant-managed evaluators, rules, and templates. Predefined evaluators remain read-only defaults loaded from Sigil's built-in registry and are not seeded into the template tables, but they are still exposed through template list/detail APIs as read-only global templates.

Example seed file:

```yaml
evaluators:
  - id: custom.json_contract.v1
    kind: json_schema
    version: "2026-02-17"
    schema:
      type: object
      required: ["answer"]
    output:
      keys:
        - key: json.valid
          type: bool

rules:
  - id: online.json_contract.api
    enabled: true
    match:
      agent_name: ["api-*"]
    sample:
      rate: 1.0
    evaluators:
      - custom.json_contract.v1
```

## Execution Model

### Ingest-Time Enqueue

`SaveBatch` writes generation rows and `eval_enqueue_events` in the same DB transaction. A lightweight ingest hook only notifies a dispatcher; it does not perform rule matching inline.

The enqueue dispatcher then:

1. Claims enqueue events with `FOR UPDATE SKIP LOCKED` (distributed-safe across pods).
2. Recovers stale claims (crash-safe claim timeout handling).
3. For each event, runs selector + match + sampling logic and inserts matching `(generation, rule, evaluator)` work items into `eval_work_items`.
4. Completes the enqueue event on success, or retries with exponential backoff on transient errors.
5. Marks enqueue events failed after max attempts or permanent errors.

### Worker Lifecycle

The eval worker runs as a separate runtime target (`eval-worker`) using the dskit `services.NewBasicService` pattern (same as compactor):

1. **Claim**: select work items where `status = 'queued' AND scheduled_at <= now()` with row lock.
2. **Load**: fetch generation payload from MySQL hot store.
3. **Build input**: resolve evaluator prompt variables from the normalized generation payload (latest user message, user history, assistant response, tool calls/results, tools, assistant sequence, stop reason, system prompt, and call error) with truncation limits.
4. **Execute**: dispatch to the appropriate evaluator kind.
5. **Write**: insert score rows into `generation_scores` (idempotent by `score_id`).
6. **Update**: mark work item as `success` or `failed`.

### Retry Policy

- Transient errors: retry with exponential backoff up to `max_attempts` (default 3).
- Permanent errors (validation, missing generation): mark `failed` without retry.

### Global Budgets

- `max_executions_per_minute`: rate limiter across all workers.
- `max_concurrent_workers`: bounded worker pool.
- Backpressure: if queue depth exceeds threshold, workers slow down and emit metrics.

## Selectors

Built-in heuristics computed from the normalized generation payload:

**`user_visible_turn`** (recommended default): The generation has at least one `MESSAGE_ROLE_ASSISTANT` output message with a `text` part (excluding `thinking`), and no `tool_call` parts in output.

**`all_assistant_generations`**: Any generation with at least one `MESSAGE_ROLE_ASSISTANT` output message.

**`tool_call_steps`**: Generations with `tool_call` parts in output. Useful for evaluating tool selection quality.

**`errored_generations`**: Generations with `call_error` present.

**Explicit overrides via tags**: Applications that know more can tag generations with `sigil.visibility=user|internal` to override the heuristic.

## Filter Fields (v1)

Generation payload fields available for rule matching:

- `agent_name`, `agent_version` (glob match)
- `model.provider`, `model.name` (exact or glob)
- `operation_name` (exact or glob)
- `mode` (SYNC / STREAM)
- `tags.*` (exact match on tag key-value pairs)
- `error.type`, `error.category` (presence or exact)

## Observability

Operators need full visibility into evaluation throughput, cost, latency, and health per tenant and per evaluator kind. All metrics carry `tenant_id` so multi-tenant deployments can attribute resource consumption. The `evaluator_kind` label (`llm_judge`, `json_schema`, `regex`, `heuristic`) is on all execution metrics so operators can see who is consuming what, regardless of whether the evaluator makes external calls.

### Evaluation Pipeline Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `sigil_eval_executions_total` | counter | `tenant_id`, `evaluator`, `evaluator_kind`, `rule`, `status` | Total evaluator executions. `status` is `success`, `failed`, `skipped`. |
| `sigil_eval_duration_seconds` | histogram | `tenant_id`, `evaluator`, `evaluator_kind`, `rule` | End-to-end evaluator execution latency (including judge call for `llm_judge`). |
| `sigil_eval_scores_total` | counter | `tenant_id`, `evaluator`, `evaluator_kind`, `rule`, `score_key`, `passed` | Scores produced, split by kind and pass/fail. |
| `sigil_eval_queue_depth` | gauge | `tenant_id`, `status` | Current work item count by status (`queued`, `claimed`, `failed`). |
| `sigil_eval_enqueue_total` | counter | `tenant_id`, `evaluator_kind`, `rule` | Work items enqueued from ingest hook, split by kind. |
| `sigil_eval_enqueue_errors_total` | counter | `tenant_id` | Enqueue failures while converting durable enqueue events into work items. |
| `sigil_eval_retries_total` | counter | `tenant_id`, `evaluator`, `evaluator_kind`, `rule` | Retry attempts for transient failures. |

### LLM Judge Metrics (per-tenant cost tracking)

Every judge API call is instrumented. These are the critical metrics for cost visibility:

| Metric | Type | Labels | Description |
|---|---|---|---|
| `sigil_eval_judge_requests_total` | counter | `tenant_id`, `provider`, `model`, `status` | Judge API calls. `status` is `success`, `error`, `timeout`. |
| `sigil_eval_judge_duration_seconds` | histogram | `tenant_id`, `provider`, `model` | Judge API call latency (network + inference). |
| `sigil_eval_judge_tokens_total` | counter | `tenant_id`, `provider`, `model`, `direction` | Tokens consumed. `direction` is `input`, `output`, `cache_read`. |
| `sigil_eval_judge_errors_total` | counter | `tenant_id`, `provider`, `model`, `error_type` | Judge errors by type (`rate_limit`, `auth`, `timeout`, `server_error`, `invalid_response`). |

### Operator Use Cases

With these metrics, operators can:

- **Identify heavy tenants**: `sum by (tenant_id, evaluator_kind)(rate(sigil_eval_executions_total[1h]))` shows evaluation volume per tenant, split by kind. A tenant running thousands of `heuristic` evals per minute is still consuming worker capacity.
- **Track LLM cost per tenant**: `rate(sigil_eval_judge_tokens_total[1h]) * cost_per_token` gives real-time spend attribution.
- **Set alerts on spend or volume**: alert when a tenant's token usage or execution count exceeds a threshold.
- **Compare kinds**: `sum by (evaluator_kind)(rate(sigil_eval_executions_total[5m]))` shows the load split across `llm_judge` vs `heuristic` vs `regex` vs `json_schema`.
- **Monitor judge health**: error rates, latency p99, timeout frequency per provider/model.
- **Capacity plan**: queue depth + execution rate by kind tells you if workers are keeping up and whether the bottleneck is judge latency or pure volume.
- **Debug regressions**: pass-rate drops (`sigil_eval_scores_total` where `passed=false`) correlated with model/evaluator/kind changes.

### Score Ingest Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `sigil_eval_score_ingest_total` | counter | `tenant_id`, `source` | Scores ingested. `source` is `online_rule` or `external_api`. |
| `sigil_eval_score_ingest_errors_total` | counter | `tenant_id`, `error_type` | Score ingest validation errors. |

### Control Plane Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `sigil_eval_active_rules` | gauge | `tenant_id` | Number of enabled rules per tenant. |
| `sigil_eval_active_evaluators` | gauge | `tenant_id` | Number of evaluator definitions per tenant. |

### Logs

Structured logs with:
- `work_id`, `generation_id`, `evaluator_id`, `rule_id`, `tenant_id` on every evaluation.
- Judge call details: `provider`, `model`, `input_tokens`, `output_tokens`, `latency_ms`.
- Error context: full error message + type for failed evaluations.

### Optional: Evaluation Spans

Opt-in: export an "evaluation span" as a child of the generation span for trace-linked debugging in Tempo. Includes judge call as a nested span with token usage attributes.

## Security and Privacy

- Evaluator inputs respect content capture policies: truncated normalized content only.
- Per-evaluator `requires_content` gating: if required fields are missing, mark score as `skipped`.
- Judge model credentials stored in environment variables or CSP IAM roles (see provider table), never in evaluator objects or the DB.
- Score retention can differ from generation payload retention.
- Never include raw provider artifacts by default.

## Known Gaps

### Infra Metadata

Generations bypass Alloy, so infra metadata (k8s namespace, cluster, service.name) is not on generation payloads. Online eval rules can only filter on generation payload fields.

**Workaround:** Users who need to filter by namespace should set explicit tags in SDK config, e.g., `tags: { "k8s.namespace": "production" }`.

**Future:** SDK auto-read of `OTEL_RESOURCE_ATTRIBUTES` env var to copy relevant keys into generation tags automatically.

### Code Sandbox

We do not build a sandbox runtime for user-uploaded evaluator code. The score export API covers this use case: users run arbitrary evaluation logic in their own infra and push results back.

### Session-Level Evaluation

Sigil does not detect when a conversation or session is "complete." This is consistent with market leaders (Langfuse, Braintrust). Conversation-level rollups are computed in the UI from per-generation scores.

## Plugin Integration Points (Brief)

- Conversation list: show score badges from latest eligible turn per conversation.
- Conversation detail: per-generation score badges in the timeline.
- Evaluation page: list rules, evaluators, health metrics, error rates.
- Filter: `has_failing_scores` (future, same pattern as `has_bad_rating`).

## Future Extensions

- Step-level evaluators using Tempo span queries.
- Trajectory/episode scoring anchored on `run_id`.
- SDK auto-read of `OTEL_RESOURCE_ATTRIBUTES` for infra tag injection.
- Backfill: "score last 24h" button in UI.
- Alerting templates for "pass-rate drop" and "mean score regression."
- Evaluator versioning UI with prompt diff.
