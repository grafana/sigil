# Repository Guidelines

## Architecture

- `apps/plugin`: Grafana plugin UI + backend proxy for Sigil query APIs.
- `api`: OTLP trace ingest + generation ingest + query APIs.
- `sdks/*`: manual post-LLM instrumentation helpers.

## Runtime Workflow (Compose-First)

- Keep `docker compose` running while developing; rely on hot reload.
- Use `docker compose logs -f <service>` for debugging.
- Check bind mounts and service commands in `docker-compose.yaml` before restarting containers.

## Coding Defaults

- Prefer simple, explicit code over clever abstractions.
- Add comments only where logic is non-obvious.
- Every bug fix includes a regression test.
- No hacks.

## Planning Questions (Agent Behavior)

- When asking the user to choose in planning mode, include enough context to explain why the decision matters and what changes based on the answer.
- For each choice, explain the main tradeoff (for example: speed vs. correctness, short-term vs. long-term maintainability).
- If the decision changes code structure or APIs, include a tiny representative snippet for each option so the user can compare concrete outcomes.

## Go Rules

- Prefer idiomatic Go and standard library first.
- Use `context.Context` only for cancellation, deadlines, tracing, and request-scoped metadata.
- Never pass runtime dependencies through `context.Context`.
- Define interfaces where they are consumed, not where they are implemented.
- Keep packages loosely coupled; avoid heavy cross-package implementation ties.
- Add tests where they improve confidence.
- Prefer table-driven tests when many similar cases exist.

## TypeScript / React Rules

- Keep KISS and DRY.
- Build small focused components.
- Always use explicit types for props, state, and API contracts.
- For SDK/public packages, split implementation into focused modules (types/client/transport/providers); avoid monolithic single-file runtime implementations.
- Keep plugin code under `apps/plugin/src`.
- Use `getBackendSrv().fetch()` for plugin-to-backend calls.

## Generation Ingest Contract

- Custom ingest is generation-first.
- Use `GenerationIngestService.ExportGenerations` (gRPC) or `POST /api/v1/generations:export` (HTTP parity).
- Provider wrappers must set generation mode explicitly:
  - non-stream: `SYNC`
  - stream: `STREAM`
- Raw provider artifacts are default OFF; enable only via explicit debug opt-in.

## Docs Map

- Canonical architecture: `ARCHITECTURE.md`
- Canonical docs index: `docs/index.md`
- Design docs index: `docs/design-docs/index.md`
- Product specs index: `docs/product-specs/index.md`
- Execution plans:
  - active: `docs/exec-plans/active/`
  - completed: `docs/exec-plans/completed/`
  - tech debt: `docs/exec-plans/tech-debt-tracker.md`
- Generation ingest reference: `docs/references/generation-ingest-contract.md`
- Benchmark + OTEL references: `docs/references/competitive-benchmark.md`

## Documentation Governance

- Keep architecture, project priorities, and cross-project context in `ARCHITECTURE.md` and `docs/` only.
- Do not store priority/project context in code comments, random root markdown files, or package-level READMEs.
- If architecture or contracts change, update `ARCHITECTURE.md` in the same change.
- If work is in design, create or update a design doc in `docs/design-docs/` and an active plan in `docs/exec-plans/active/`.
- When design or execution is completed, update status and move the exec plan to `docs/exec-plans/completed/`.

## When To Update Docs

| Repo Area | Update Triggers | Required Docs |
| --- | --- | --- |
| any | architecture shape, system boundaries, or project priority changes | `ARCHITECTURE.md` and relevant `docs/*` pages |
| any | new design started or design direction changed | relevant file in `docs/design-docs/` and matching file in `docs/exec-plans/active/` |
| any | execution completed | move plan to `docs/exec-plans/completed/` and update linked design/spec status |
| `apps/plugin` | query/proxy contract changes, UI behavior or data model changes | `ARCHITECTURE.md`, `docs/FRONTEND.md`, relevant plan/spec doc |
| `api` | ingest/query endpoint changes, proto changes, validation/storage behavior changes | `ARCHITECTURE.md`, `docs/references/generation-ingest-contract.md`, relevant exec plan |
| `sdks/*` | config/lifecycle changes, generation schema changes, provider wrapper behavior changes | `ARCHITECTURE.md`, `sdks/go/README.md`, relevant plan/reference docs |

## Quality Commands

- `mise run format`
- `mise run lint`
- `mise run check`

## Commit Standard

- Use Conventional Commits.
- Explain both what changed and why in commit body.
