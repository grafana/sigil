---
title: Configure online evaluation
menuTitle: Tune evaluation settings
description: Set up LLM judges, evaluator types, rules, and providers for continuous quality scoring in Sigil.
keywords:
  - Sigil
  - evaluation
  - LLM judge
  - quality
  - configuration
weight: 3
---

# Configure online evaluation

Online evaluation continuously scores live generation traffic. You configure evaluators that define how to score, and rules that define which generations to evaluate.

## Enable the eval worker

Set these environment variables (or Helm values) to enable evaluation:

| Variable | Default | Description |
|----------|---------|-------------|
| `SIGIL_EVAL_WORKER_ENABLED` | `false` | Enable the evaluation worker loop. |
| `SIGIL_EVAL_MAX_CONCURRENT` | `8` | Maximum in-flight evaluations. |
| `SIGIL_EVAL_MAX_RATE` | `600` | Maximum evaluations per minute. |
| `SIGIL_EVAL_MAX_ATTEMPTS` | `3` | Retry cap for transient failures. |
| `SIGIL_EVAL_CLAIM_BATCH_SIZE` | `20` | Work items claimed per cycle. |
| `SIGIL_EVAL_POLL_INTERVAL` | `250ms` | How often the worker claims new work. |
| `SIGIL_EVAL_DEFAULT_JUDGE_MODEL` | `openai/gpt-4o-mini` | Default model for LLM judge evaluators. |

## Configure judge providers

The eval worker discovers judge providers based on environment variables. Configure the providers you want to use:

| Provider | Required variable |
|----------|------------------|
| OpenAI | `SIGIL_EVAL_OPENAI_API_KEY` |
| Azure OpenAI | `SIGIL_EVAL_AZURE_OPENAI_ENDPOINT`, `SIGIL_EVAL_AZURE_OPENAI_API_KEY` |
| Anthropic | `SIGIL_EVAL_ANTHROPIC_API_KEY` |
| AWS Bedrock | AWS default credentials or `SIGIL_EVAL_BEDROCK_BEARER_TOKEN` |
| Google | `SIGIL_EVAL_GOOGLE_API_KEY` |
| Vertex AI | `SIGIL_EVAL_VERTEXAI_PROJECT` |
| Anthropic on Vertex | `SIGIL_EVAL_ANTHROPIC_VERTEX_PROJECT` |
| OpenAI-compatible | Custom endpoint with optional API key |

## Create evaluators

Use the Sigil plugin UI or the evaluation API to create evaluators. Four evaluator types are available:

### LLM judge

Uses an LLM to score generations based on criteria you define in a prompt template.

Key settings:
- `provider` and `model` — the LLM to use for judging.
- `system_prompt` and `user_prompt` — prompt templates with variables.
- `max_tokens`, `temperature`, `timeout_ms` — generation controls.

### JSON schema

Validates that the assistant response matches a JSON schema. Returns `true` or `false`.

### Regex

Checks the assistant response against one or more regex patterns. Use `reject: true` to invert the match.

### Heuristic

Applies a rule tree with AND/OR logic. Supported checks: `not_empty`, `contains`, `not_contains`, `min_length`, `max_length`.

## Template variables

LLM judge prompts support these template variables:

| Variable | Content |
|----------|---------|
| `{{latest_user_message}}` | Most recent user message |
| `{{user_history}}` | All user messages |
| `{{assistant_response}}` | Assistant output |
| `{{assistant_thinking}}` | Thinking/reasoning content |
| `{{system_prompt}}` | System prompt |
| `{{tool_calls}}` | Tool call details |
| `{{tool_results}}` | Tool result details |
| `{{tools}}` | Available tool definitions |
| `{{call_error}}` | Error information |

## Create rules

Rules connect evaluators to generation traffic. Each rule has:

- **Selector** — which generations to evaluate:
  - `user_visible_turn` — assistant text responses without tool calls.
  - `all_assistant_generations` — any assistant output.
  - `tool_call_steps` — generations with tool calls.
  - `errored_generations` — generations with errors.
- **Match filters** — additional criteria to narrow the selection.
- **Sampling rate** — percentage of matching generations to evaluate.
- **Evaluator** — the evaluator to run.

## Next steps

- [Set up evaluation end-to-end](../../guides/evaluation/)
- [Configure deployment options](../deployment/)
