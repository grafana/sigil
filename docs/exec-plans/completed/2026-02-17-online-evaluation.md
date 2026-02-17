---
owner: sigil-core
status: completed
last_reviewed: 2026-02-17
source_of_truth: true
audience: both
---

# Online Evaluation Delivery

## Goal

Deliver configurable, asynchronous online evaluation of production generations. Evaluators run inside Sigil workers, scoring eligible generations with a predefined library of templates and user-defined evaluators. External scores can also be pushed via API. Configuration is API-managed with optional YAML seed.

## Scope

- MySQL schema for scores, work items, evaluator definitions, and rules.
- Control plane CRUD APIs for evaluators and rules.
- Predefined evaluator library seeded on first boot.
- Score ingest API for external (bring-your-own) evaluators.
- Score query APIs integrated with generation detail.
- Built-in evaluator implementations: `llm_judge`, `json_schema`, `regex`, `heuristic`.
- Rule engine: selector heuristics, match filters, conversation-level sampling.
- Eval worker runtime target with claim loop, dispatch, retry, and global budgets.
- Reference documentation and seed config example.

## Out of scope

- Plugin frontend UI (follow-up plan).
- SDK evaluation helpers (follow-up plan).
- Eval spans / Tempo integration for evaluation traces (follow-up plan).
- Code sandbox runtime for user-uploaded evaluator code.
- Session-level / trajectory evaluation.

## Source design doc

- `docs/design-docs/2026-02-17-online-evaluation.md`

## Completion policy

- A checkbox moves to `[x]` only when implementation code and automated tests for that item are merged to `main`.
- Design docs, architecture text, or branch-local changes are not sufficient to close checklist items.

## Implementation phases

### Phase 1: Storage models and migrations

Files: `sigil/internal/storage/mysql/models.go`, `sigil/internal/storage/mysql/eval.go` (new)

- [x] Add `GenerationScoreModel` GORM model matching `generation_scores` DDL.
- [x] Add `EvalWorkItemModel` GORM model matching `eval_work_items` DDL.
- [x] Add `EvalEvaluatorModel` GORM model matching `eval_evaluators` DDL.
- [x] Add `EvalRuleModel` GORM model matching `eval_rules` DDL.
- [x] Register models in auto-migration.
- [x] Implement `EvalStore` interface in `sigil/internal/storage/mysql/eval.go`:
  - `CreateEvaluator`, `GetEvaluator`, `ListEvaluators`, `DeleteEvaluator`
  - `CreateRule`, `GetRule`, `ListRules`, `UpdateRule`, `DeleteRule`
  - `InsertScore`, `InsertScoreBatch`, `GetScoresByGeneration`, `GetScoresByRule`
  - `EnqueueWorkItem`, `ClaimWorkItems`, `CompleteWorkItem`, `FailWorkItem`
- [x] Add unit tests for store CRUD operations.
- [x] Add unit tests for work item claim/complete/fail lifecycle.

**Exit criteria:** Tables auto-migrate successfully. All store methods pass unit tests with a test MySQL instance.

### Phase 2: Control plane APIs (evaluators and rules)

Files: `sigil/proto/sigil/v1/evaluation.proto` (new), `sigil/internal/eval/control/service.go` (new), `sigil/internal/eval/control/http.go` (new)

- [x] Define protobuf messages: `Evaluator`, `Rule`, `CreateEvaluatorRequest/Response`, `ListEvaluatorsRequest/Response`, `GetEvaluatorRequest/Response`, `DeleteEvaluatorRequest/Response`, `CreateRuleRequest/Response`, `ListRulesRequest/Response`, `GetRuleRequest/Response`, `UpdateRuleRequest/Response`, `DeleteRuleRequest/Response`.
- [x] Generate Go code from proto.
- [x] Implement `ControlService` struct with methods for evaluator and rule CRUD.
- [x] Register HTTP routes:
  - `POST /api/v1/eval/evaluators`
  - `GET /api/v1/eval/evaluators`
  - `GET /api/v1/eval/evaluators/{id}`
  - `DELETE /api/v1/eval/evaluators/{id}`
  - `POST /api/v1/eval/rules`
  - `GET /api/v1/eval/rules`
  - `GET /api/v1/eval/rules/{id}`
  - `PATCH /api/v1/eval/rules/{id}`
  - `DELETE /api/v1/eval/rules/{id}`
- [x] Implement predefined evaluator template definitions in `sigil/internal/eval/predefined/templates.go` (new).
- [x] Implement seeder in `sigil/internal/eval/predefined/seed.go` (new) that inserts predefined templates on first boot.
- [x] Implement optional YAML seed loader in `sigil/internal/eval/control/seed.go` (new).
- [x] Add API tests for evaluator CRUD (create, list, get, delete, soft-delete idempotency).
- [x] Add API tests for rule CRUD (create, list, get, update, delete, enable/disable).
- [x] Add tests for predefined template seeding (templates appear after seed, idempotent re-seed).
- [x] Add tests for YAML seed loader (valid YAML, invalid YAML, duplicate IDs).

**Exit criteria:** Create/list/update/delete evaluators and rules via API. Predefined templates appear in list after first boot. YAML seed file loads and inserts correctly.

### Phase 3: Score ingest API

Files: `sigil/proto/sigil/v1/evaluation_ingest.proto` (new), `sigil/internal/eval/ingest/service.go` (new), `sigil/internal/eval/ingest/http.go` (new)

- [x] Define protobuf messages: `ExportScoresRequest`, `ExportScoresResponse`, `ScoreItem`, `ScoreValue`.
- [x] Generate Go code from proto.
- [x] Implement `IngestService` with validation:
  - Required fields: `score_id`, `generation_id`, `evaluator_id`, `score_key`, `value`.
  - `score_id` uniqueness (idempotent: duplicate = success).
  - `generation_id` existence check (configurable: reject or accept-with-warning).
  - Score value type validation.
- [x] Register HTTP route: `POST /api/v1/scores:export`.
- [x] Per-item response format: each score item gets accept/reject with reason.
- [x] Add API tests for score ingest (valid payload, idempotency, validation errors, partial batch).

**Exit criteria:** API accepts scores, idempotency works (re-sending same `score_id` succeeds), validation rejects bad input with per-item error messages.

### Phase 4: Score query APIs

Files: `sigil/internal/eval/query/service.go` (new), `sigil/internal/eval/query/http.go` (new)

- [x] Implement `GET /api/v1/generations/{generation_id}/scores` with pagination (cursor-based).
- [x] Extend generation detail response (existing `GET /api/v1/generations/{id}`) with `latest_scores` summary field.
  - `latest_scores`: map of `score_key -> { value, passed, evaluator_id, created_at }` (latest score per key).
- [x] Add store read methods: `GetLatestScoresByGeneration` (deduped by key, latest wins).
- [x] Add API tests for score query (pagination, empty results, multiple scores per key returns latest).
- [x] Add API tests for generation detail with scores.

**Exit criteria:** Scores returned with cursor pagination. Generation detail includes `latest_scores` summary. Latest-per-key deduplication works correctly.

### Phase 5: Rule engine and evaluators

Files: `sigil/internal/eval/rules/engine.go` (new), `sigil/internal/eval/rules/selector.go` (new), `sigil/internal/eval/rules/matcher.go` (new), `sigil/internal/eval/rules/sampler.go` (new), `sigil/internal/eval/evaluators/interface.go` (new), `sigil/internal/eval/evaluators/regex.go` (new), `sigil/internal/eval/evaluators/json_schema.go` (new), `sigil/internal/eval/evaluators/heuristic.go` (new), `sigil/internal/eval/evaluators/llm_judge.go` (new), `sigil/internal/eval/evaluators/judges/client.go` (new), `sigil/internal/eval/evaluators/judges/openai.go` (new), `sigil/internal/eval/evaluators/judges/openai_compat.go` (new), `sigil/internal/eval/evaluators/judges/anthropic.go` (new), `sigil/internal/eval/evaluators/judges/google.go` (new), `sigil/internal/eval/evaluators/judges/discovery.go` (new)

- [x] Define `Evaluator` interface:
  ```go
  type Evaluator interface {
      Evaluate(ctx context.Context, input EvalInput) ([]ScoreOutput, error)
  }
  ```
- [x] Implement `user_visible_turn` selector: assistant output with text part, no tool_call parts.
- [x] Implement `all_assistant_generations` selector.
- [x] Implement `tool_call_steps` selector.
- [x] Implement `errored_generations` selector.
- [x] Implement rule matcher: glob match for `agent_name`, `agent_version`, `model.provider`, `model.name`, `operation_name`; exact match for `mode`, `tags.*`, `error.type`, `error.category`.
- [x] Implement conversation-level sampler: `hash(tenant_id + conversation_id + rule_id) % 10000 < (sample_rate * 10000)`.
- [x] Implement `regex` evaluator: match/not-match patterns against response text.
- [x] Implement `json_schema` evaluator: validate response as JSON against provided schema.
- [x] Implement `heuristic` evaluator: length bounds, empty check, contains/not-contains.
- [x] Define `JudgeClient` interface in `sigil/internal/eval/evaluators/judges/client.go`:
  ```go
  type JudgeClient interface {
      Judge(ctx context.Context, req JudgeRequest) (JudgeResponse, error)
      ListModels(ctx context.Context) ([]JudgeModel, error)
  }
  ```
- [x] Implement OpenAI judge client (`judges/openai.go`) using `openai-go` SDK. Support direct API key auth and Azure OpenAI variant.
- [x] Implement OpenAI-compatible judge client (`judges/openai_compat.go`) using an HTTP compatibility adapter with custom base URL. Support multiple named instances via env vars or control plane API. Covers Ollama, vLLM, LM Studio, LiteLLM, OpenRouter.
- [x] Implement Anthropic judge client (`judges/anthropic.go`) using `anthropic-sdk-go`. Support direct API key auth and AWS Bedrock variant (SigV4 via `aws-sdk-go-v2`).
- [x] Implement Google judge client (`judges/google.go`) using `google.golang.org/genai`. Support Gemini API key auth and Vertex AI variant (OAuth2 via Application Default Credentials).
- [x] Implement judge provider discovery in `judges/discovery.go`: enumerate configured providers from env vars, validate credentials, expose `ListProviders` and `ListModels`.
- [x] Implement `llm_judge` evaluator: prompt template rendering, provider/model resolution, judge client dispatch, response parsing, timeout + token limits.
- [x] Add configuration: `SIGIL_EVAL_DEFAULT_JUDGE_MODEL` (default `openai/gpt-4o-mini`).
- [x] Register judge discovery HTTP routes:
  - `GET /api/v1/eval/judge/providers` -- list configured providers.
  - `GET /api/v1/eval/judge/models?provider={id}` -- list models for a provider.
- [x] Add unit tests for each selector heuristic.
- [x] Add unit tests for rule matcher (glob, exact, tags).
- [x] Add unit tests for sampler determinism and distribution.
- [x] Add unit tests for `regex` evaluator.
- [x] Add unit tests for `json_schema` evaluator.
- [x] Add unit tests for `heuristic` evaluator.
- [x] Add unit tests for each judge client (OpenAI, Anthropic, Google) with mocked SDK responses.
- [x] Add unit tests for `llm_judge` evaluator (mocked judge client).
- [x] Add tests for judge provider discovery (configured/unconfigured providers, model listing).

**Exit criteria:** Selectors compute correctly on sample generation payloads. Matchers handle glob and exact matching. Sampling is deterministic and evenly distributed. All evaluator kinds return typed score outputs and handle errors gracefully. Judge discovery API returns only configured providers. CSP variants (Azure, Bedrock, Vertex) work when credentials are present.

### Phase 6: Ingest hook and eval worker

Files: `sigil/internal/storage/mysql/wal.go` (modify), `sigil/internal/eval/worker/service.go` (new), `sigil/internal/eval/worker/worker.go` (new), `sigil/internal/eval/worker/metrics.go` (new), `sigil/cmd/sigil/main.go` (modify), `sigil/internal/config/config.go` (modify)

- [x] Add `EvalHook` interface consumed by WAL store:
  ```go
  type EvalHook interface {
      OnGenerationsSaved(tenantID string)
  }
  ```
- [x] Add durable enqueue table (`eval_enqueue_events`) and persist enqueue intent in the same transaction as generation rows.
- [x] Implement enqueue dispatcher service: claim events, apply selectors/matchers/sampling, enqueue work items, complete/retry/fail with exponential backoff.
- [x] Wire WAL hook as notifier-only wake signal for dispatcher (no lossy timeout-based inline enqueue path).
- [x] Implement `eval-worker` runtime target using dskit `services.NewBasicService` pattern.
- [x] Worker claim loop: `ClaimWorkItems` -> fetch generation payload -> build evaluator input -> dispatch to evaluator -> write scores -> update work item status.
- [x] Retry policy: exponential backoff up to `max_attempts` (default 3). Permanent errors: mark `failed` without retry.
- [x] Global budgets: `max_executions_per_minute` (rate limiter), `max_concurrent_workers` (semaphore).
- [x] Add configuration keys: `SIGIL_EVAL_WORKER_ENABLED`, `SIGIL_EVAL_MAX_CONCURRENT`, `SIGIL_EVAL_MAX_RATE`, `SIGIL_EVAL_MAX_ATTEMPTS`, `SIGIL_EVAL_CLAIM_BATCH_SIZE`.
- [x] Implement Prometheus metrics in `sigil/internal/eval/worker/metrics.go`:
  - Pipeline metrics: `sigil_eval_executions_total{tenant_id, evaluator, evaluator_kind, rule, status}`, `sigil_eval_duration_seconds{tenant_id, evaluator, evaluator_kind, rule}`, `sigil_eval_scores_total{tenant_id, evaluator, rule, score_key, passed}`, `sigil_eval_queue_depth{tenant_id, status}`, `sigil_eval_enqueue_total{tenant_id, rule}`, `sigil_eval_enqueue_errors_total{tenant_id}`, `sigil_eval_retries_total{tenant_id, evaluator, rule}`.
  - LLM judge metrics (per-tenant usage): `sigil_eval_judge_requests_total{tenant_id, provider, model, status}`, `sigil_eval_judge_duration_seconds{tenant_id, provider, model}`, `sigil_eval_judge_tokens_total{tenant_id, provider, model, direction}`, `sigil_eval_judge_errors_total{tenant_id, provider, model, error_type}`.
  - Score ingest metrics: `sigil_eval_score_ingest_total{tenant_id, source}`, `sigil_eval_score_ingest_errors_total{tenant_id, error_type}`.
  - Control plane metrics: `sigil_eval_active_rules{tenant_id}`, `sigil_eval_active_evaluators{tenant_id}`.
- [x] Instrument judge clients: wrap each `JudgeClient` with a metrics-emitting decorator that records request count, latency, tokens, and errors per `(tenant_id, provider, model)`.
- [x] Add end-to-end integration test: ingest generation -> work item created -> worker claims -> evaluator runs -> score in DB.
- [x] Add unit tests for durable enqueue lifecycle (claim, complete, retry, permanent fail, stale-claim recovery).
- [x] Add unit tests for enqueue dispatcher retry and permanent-failure handling.
- [x] Add unit tests for worker retry and permanent failure handling.
- [x] Add unit tests for rate limiter and concurrency cap.
- [x] Add unit tests for metrics instrumentation (counter increments, histogram observations on judge calls).

**Exit criteria:** Generation ingest durably records enqueue intent, dispatcher materializes work items with retry semantics, worker claims and evaluates, and scores appear in DB. Integration test passes end-to-end. All Prometheus metrics emit correctly with tenant_id labels. Judge token usage is tracked per tenant/provider/model.

### Phase 7: Docs and seed config

Files: `docs/references/score-ingest-contract.md` (new), `docs/references/eval-control-plane.md` (new), `sigil-eval-seed.example.yaml` (new), `ARCHITECTURE.md` (modify)

- [x] Write score ingest API reference doc (request/response format, validation rules, idempotency).
- [x] Write control plane API reference doc (evaluator and rule CRUD, predefined templates, YAML seed format).
- [x] Create example `sigil-eval-seed.example.yaml` with predefined library templates and sample rules.
- [x] Update `ARCHITECTURE.md` with online evaluation section referencing design doc.
- [x] Update `docs/design-docs/index.md` with entry for the new design doc.

**Exit criteria:** Reference docs complete and accurate. Seed config validates and seeds correctly when loaded. Architecture doc updated.
