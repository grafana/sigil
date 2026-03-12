---
owner: sigil-core
status: active
last_reviewed: 2026-03-12
source_of_truth: true
audience: contributors
---

# Symphony Setup

This repo is wired to run [OpenAI Symphony](https://github.com/openai/symphony)
against the Grafana Sigil Linear team. The repo-local workflow and worker
skills are committed so that Symphony workspaces clone everything they need.

## What lives in the repo

- [`../../WORKFLOW.md`](../../WORKFLOW.md): the committed Symphony workflow
  template.
- `WORKFLOW.local.md`: ignored local render of the workflow template used for a
  developer's personal Linear project.
- [`../../.agents/skills/`](../../.agents/skills/): worker skills used by
  Symphony agents.
- [`../../.agents/skills/launch-app/SKILL.md`](../../.agents/skills/launch-app/SKILL.md):
  Sigil-specific runtime validation instructions.

## Prerequisites

- `codex` installed and authenticated.
- `gh` installed and authenticated.
- `mise` installed.
- A Linear personal API key exported as `LINEAR_API_KEY`.
- Linear MCP authenticated once via:
  ```bash
  codex mcp add linear --url https://mcp.linear.app/mcp
  codex mcp login linear
  ```

Quick checks:

```bash
codex --version
gh auth status
mise --version
test -n "$LINEAR_API_KEY" && echo set || echo missing
```

## Linear setup

Team key: `GRA`

Use a personal Symphony project per developer. Do not point several developers
at the same Linear project.

Recommended naming:

- `<name> Symphony`

Recommended setup flow for a new developer:

1. Create a new Linear project in team `GRA`.
2. Name it after the developer, for example `Alice Symphony`.
3. Keep the required workflow states on team `GRA`:
   `Todo`, `In Progress`, `Rework`, `Human Review`, `Merging`, `Done`.
4. Render your local workflow file:
   ```bash
   ./scripts/render-symphony-workflow.sh <your-project-slug>
   ```
5. Launch Symphony with `WORKFLOW.local.md`, not the committed template.
6. Treat that slug as personal local configuration, not a shared repo default.

Required team states:

- `Todo`
- `In Progress`
- `Rework`
- `Human Review`
- `Merging`
- `Done`

To point Symphony at your personal project, render the local workflow file from
the committed template:

```bash
./scripts/render-symphony-workflow.sh <your-project-slug>
```

or:

```bash
SYMPHONY_LINEAR_PROJECT_SLUG=<your-project-slug> mise run workflow:symphony:render
```

Do not edit the tracked [`../../WORKFLOW.md`](../../WORKFLOW.md) with a
personal slug, and do not launch Symphony against the template file.

## Build Symphony

Use the `odysseus0/symphony` fork:

```bash
mkdir -p ~/code
git clone https://github.com/odysseus0/symphony.git ~/code/symphony
cd ~/code/symphony/elixir
mise trust
mise install
mise exec -- mix setup
mise exec -- mix build
```

## Repo bootstrap behavior

When Symphony creates a fresh workspace for a ticket, the repo workflow runs:

```bash
git clone --depth 1 git@github.com:grafana/sigil.git .
[ -f .env ] || cp .env.example .env
mise trust
mise install
mise run doctor:go
mise run deps
```

That logic lives in the committed template
[`../../WORKFLOW.md`](../../WORKFLOW.md). Keep it aligned with the repo's
actual bootstrap requirements.

## Launch Symphony

First render the local workflow:

```bash
./scripts/render-symphony-workflow.sh <your-project-slug>
```

From the Symphony checkout:

```bash
cd ~/code/symphony/elixir
mise exec -- ./bin/symphony \
  --port 4041 \
  --i-understand-that-this-will-be-running-without-the-usual-guardrails \
  /absolute/path/to/sigil/WORKFLOW.local.md
```

For this repo checkout, render a local workflow file and pass its absolute path:

```bash
cd /absolute/path/to/sigil
SYMPHONY_LINEAR_PROJECT_SLUG=<your-project-slug> \
  ./scripts/render-symphony-workflow.sh
realpath WORKFLOW.local.md
```

Suggested background run:

```bash
mkdir -p ~/.local/state/symphony
cd ~/code/symphony/elixir
nohup mise exec -- ./bin/symphony \
  --port 4041 \
  --i-understand-that-this-will-be-running-without-the-usual-guardrails \
  /absolute/path/to/sigil/WORKFLOW.local.md \
  > ~/.local/state/symphony/sigil-symphony.log 2>&1 &
```

## Runtime validation

Symphony uses the repo-local `launch-app` skill for app-touching changes. The
skill is intentionally written for a worktree-safe model: each checkout can run
its own lighter core stack without colliding on fixed localhost ports.

Manual equivalent:

```bash
./scripts/bootstrap-env.sh
mise run up:worktree:detached
./scripts/run-sigil-worktree.sh url
curl -sf http://sigil.<worktree>.orb.local/healthz
curl -I http://grafana.<worktree>.orb.local/login
```

When a ticket benefits from remote-backed data, switch the startup command
instead of falling back to the fixed-port root stack:

```bash
mise run worktree:dev
mise run worktree:ops
```

Use `worktree:dev` for dev datasources and `worktree:ops` for ops-backed,
scale-sensitive validation. Both commands still use the same worktree-safe
OrbStack URLs and compose isolation model.

If plugin queries fail in Grafana, sign in with `admin` / `admin` and skip the
password-change prompt. In practice, treat that login as required for local
Sigil UI validation.

If the UI needs sample data, start the lightweight traffic sidecar:

```bash
mise run up:worktree:traffic-lite
```

To capture a proof screenshot from the running worktree stack:

```bash
mise run capture:ui-proof
```

That command signs in with `admin` / `admin` when needed and writes a PNG to
`output/playwright/`.

For ticket handoff quality, prefer the repo-local `ui-proof` skill over a
single smoke screenshot. That skill is meant for feature-level proof: navigate
the changed flow, capture several screenshots if needed, upload them with the
`linear_graphql` `fileUpload` path during unattended runs, and embed them into
the Linear workpad comment. The repo-local
`apps/plugin/scripts/upload-linear-assets.mjs` helper remains a local fallback
when `LINEAR_API_KEY` is already available in the shell environment. If a PR
exists for the branch, mirror at least one screenshot into the PR body or a
top-level PR comment for reviewer-facing proof.

Stop it with:

```bash
mise run down:worktree:traffic-lite
```

To remove the whole worktree stack, including named volumes for that Compose
project:

```bash
mise run down:worktree:destroy
```

By default, `scripts/bootstrap-env.sh` copies `.env` from
`~/work/sigil/.env`. Override that source with `SIGIL_SHARED_ENV_FILE` if your
machine keeps the shared env elsewhere.

## Worktree runtime recommendation

Do not let worktrees call the plain root `docker compose up` path when they
need to coexist. The normal stack still binds fixed host ports (`3000`, `8080`,
and others).

Recommended model:

- Use `mise run up:worktree` or `mise run up:worktree:detached` for checkout-
  local runtime validation.
- Use `mise run worktree:dev` when a worktree-safe stack should query dev
  datasources instead of the local Sigil backend.
- Use `mise run worktree:ops` when scale-sensitive validation is easier against
  ops datasources from a worktree-safe stack.
- Use `mise run up:worktree:traffic-lite` when UI work needs a small amount of
  synthetic data without the full `sdk-traffic` load.
- Let each worktree use its own Compose project name and OrbStack URL such as
  `http://grafana.<worktree>.orb.local`.
- Keep `.env` bootstrapped from a shared machine-local source such as
  `~/work/sigil/.env`.
- Use targeted tests for most tickets; reserve Docker runtime validation for
  changes that truly need end-to-end proof.
- Keep `agent.max_concurrent_agents` conservative at first. This repo template
  defaults to `3` in [`../../WORKFLOW.md`](../../WORKFLOW.md).
- The worktree path skips `sdk-traffic` and disables webpack typecheck/lint
  inside Docker to keep resource usage lower.

## First run expectations

- Symphony polls the personal Linear project named in `WORKFLOW.local.md`.
- Tickets in `Todo`, `In Progress`, `Rework`, or `Merging` are eligible for
  agent action based on the workflow prompt.
- The `land` skill blocks merge on human review, Codex review, and Cursor
  Bugbot findings on the current PR head.
- The project can start empty; Symphony will idle until tickets move into
  active states.

## Operational notes

- Worker behavior is branch-dependent. Commit and push repo-local skill changes
  before starting Symphony.
- Treat `WORKFLOW.local.md` as personal local configuration for the developer
  running Symphony.
- Agents may make small repo-local Symphony self-improvements while doing normal
  ticket work when those changes materially improve execution in this repo.
  Keep that narrow: skills, workflow/bootstrap, cleanup, runtime validation,
  and directly-related docs. Do not let product tickets turn into open-ended
  orchestration refactors.
- Symphony creates per-issue workspace directories under
  `~/code/symphony-workspaces`; it does not use `git worktree`.
- The `before_remove` hook now does a best-effort
  `./scripts/run-sigil-worktree.sh destroy` so per-workspace Compose resources
  are cleaned up when Symphony removes a workspace.
- Repo-local skills are intentional here. Symphony workers operate on fresh repo
  clones and need the same skill set in every workspace.
- Keep the committed template [`../../WORKFLOW.md`](../../WORKFLOW.md), the
  render script, and this guide in sync when the bootstrap commands, launch
  port, or Linear project strategy change.
