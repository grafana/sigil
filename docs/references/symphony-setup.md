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

- [`../../WORKFLOW.md`](../../WORKFLOW.md): the Symphony workflow prompt and
  runtime config.
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

Current repo default project:

- Name: `Symphony`
- URL: `https://linear.app/grafana-sigil/project/symphony-b67142b9dd44`
- `WORKFLOW.md` project slug: `symphony-b67142b9dd44`

Required team states:

- `Todo`
- `In Progress`
- `Rework`
- `Human Review`
- `Merging`
- `Done`

If you want Symphony to target a different Linear project, update
[`../../WORKFLOW.md`](../../WORKFLOW.md) before launch:

```yaml
tracker:
  project_slug: "<your-project-slug>"
```

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

That logic lives in [`../../WORKFLOW.md`](../../WORKFLOW.md). Keep it aligned
with the repo's actual bootstrap requirements.

## Launch Symphony

From the Symphony checkout:

```bash
cd ~/code/symphony/elixir
mise exec -- ./bin/symphony \
  --port 4041 \
  --i-understand-that-this-will-be-running-without-the-usual-guardrails \
  /absolute/path/to/sigil/WORKFLOW.md
```

For this repo checkout, that path is:

```bash
/Users/cyriltovena/.superset/worktrees/sigil/cyriltovena/lightning-soybean/WORKFLOW.md
```

Suggested background run:

```bash
mkdir -p ~/.local/state/symphony
cd ~/code/symphony/elixir
nohup mise exec -- ./bin/symphony \
  --port 4041 \
  --i-understand-that-this-will-be-running-without-the-usual-guardrails \
  /absolute/path/to/sigil/WORKFLOW.md \
  > ~/.local/state/symphony/sigil-symphony.log 2>&1 &
```

## Runtime validation

Symphony uses the repo-local `launch-app` skill for app-touching changes. The
skill starts the Sigil stack with Docker Compose, verifies Grafana and the API,
and includes the documented Grafana `delve` workaround.

Manual equivalent:

```bash
[ -f .env ] || cp .env.example .env
DEVELOPMENT=true docker compose --profile core up --build --remove-orphans -d
curl -sf http://localhost:8080/healthz
curl -sf http://localhost:3000 >/dev/null
```

If plugin queries fail in Grafana, sign in with `admin` / `admin` and skip the
password-change prompt.

## First run expectations

- Symphony polls the `Symphony` Linear project for active tickets.
- Tickets in `Todo`, `In Progress`, `Rework`, or `Merging` are eligible for
  agent action based on the workflow prompt.
- The `land` skill blocks merge on human review, Codex review, and Cursor
  Bugbot findings on the current PR head.
- The project can start empty; Symphony will idle until tickets move into
  active states.

## Operational notes

- Worker behavior is branch-dependent. Commit and push `WORKFLOW.md` and
  `.agents/skills/` changes before starting Symphony.
- Repo-local skills are intentional here. Symphony workers operate on fresh repo
  clones and need the same skill set in every workspace.
- Keep `WORKFLOW.md` and this guide in sync when the bootstrap commands, launch
  port, or Linear project strategy change.
