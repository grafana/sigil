---
title: Evaluation API
menuTitle: Explore evaluation API
description: API endpoints for managing evaluators, rules, and judge providers in Sigil online evaluation.
keywords:
  - Sigil
  - API
  - evaluation
  - evaluators
  - rules
weight: 2
---

# Evaluation API

The evaluation control plane API manages evaluators, rules, and judge provider discovery.

## Evaluator endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/evaluators` | List all evaluators. |
| `POST` | `/api/v1/evaluators` | Create an evaluator. |
| `GET` | `/api/v1/evaluators/{id}` | Get an evaluator by ID. |
| `PUT` | `/api/v1/evaluators/{id}` | Update an evaluator. |
| `DELETE` | `/api/v1/evaluators/{id}` | Delete an evaluator. |

## Rule endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/eval-rules` | List all evaluation rules. |
| `POST` | `/api/v1/eval-rules` | Create a rule. |
| `GET` | `/api/v1/eval-rules/{id}` | Get a rule by ID. |
| `PUT` | `/api/v1/eval-rules/{id}` | Update a rule. |
| `DELETE` | `/api/v1/eval-rules/{id}` | Delete a rule. |

## Judge provider endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/judge-providers` | List discovered judge providers. |

## Score ingest

| Transport | Endpoint |
|-----------|----------|
| HTTP | `POST /api/v1/scores:export` |

The score ingest endpoint accepts externally computed evaluation scores. Scores are idempotent — re-submitting the same score ID is a no-op.

## Evaluator types

### LLM judge

```json
{
  "kind": "llm_judge",
  "config": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "system_prompt": "You are a quality evaluator.",
    "user_prompt": "Rate this response:\n{{assistant_response}}",
    "max_tokens": 100,
    "temperature": 0.0,
    "timeout_ms": 30000
  }
}
```

### JSON schema

```json
{
  "kind": "json_schema",
  "config": {
    "schema": {
      "type": "object",
      "required": ["answer"],
      "properties": {
        "answer": { "type": "string" }
      }
    }
  }
}
```

### Regex

```json
{
  "kind": "regex",
  "config": {
    "pattern": "^\\d+$",
    "reject": false
  }
}
```

### Heuristic

```json
{
  "kind": "heuristic",
  "config": {
    "version": "v2",
    "rules": {
      "and": [
        { "not_empty": "assistant_response" },
        { "min_length": { "field": "assistant_response", "value": 10 } }
      ]
    }
  }
}
```

## Rule selectors

| Selector | Description |
|----------|-------------|
| `user_visible_turn` | Assistant text responses without tool calls. |
| `all_assistant_generations` | Any assistant output. |
| `tool_call_steps` | Generations containing tool calls. |
| `errored_generations` | Generations with `call_error`. |
