# Eval Quick-Test Design

## Problem

When creating templates or evaluators, there's no way to test the config against real data before committing. Users must publish, set up a rule, wait for async execution, and check results. This makes iteration slow.

## Solution

Add a synchronous test endpoint and UI that lets users run an evaluator config against a single generation and see results immediately, before publishing.

## Backend

### Endpoint

```
POST /api/v1/eval:test
```

Synchronously executes an evaluator config against a generation. Ephemeral — no scores persisted.

### Request

```json
{
  "kind": "llm_judge",
  "config": { "system_prompt": "...", "user_prompt": "...", "max_tokens": 256 },
  "output_keys": [{ "key": "score", "type": "number" }],
  "generation_id": "gen-abc123"
}
```

Fields mirror the evaluator definition shape. The body is the same regardless of whether the config comes from a template form, publish version form, or evaluator form.

### Response

```json
{
  "generation_id": "gen-abc123",
  "conversation_id": "conv-xyz",
  "scores": [
    {
      "key": "score",
      "type": "number",
      "value": 8,
      "passed": true,
      "explanation": "The response was helpful and accurate...",
      "metadata": {}
    }
  ],
  "execution_time_ms": 1234
}
```

### Implementation

1. Validate kind, config, output_keys (reuse existing validation from control layer)
2. Fetch generation by ID from storage (reuse worker's generation reader)
3. Build `EvalInput` from generation (reuse worker's input builder)
4. Instantiate evaluator by kind (reuse existing evaluator implementations)
5. Call `Evaluate()` synchronously with 30s timeout
6. Return scores directly

No new evaluator logic — the handler composes existing components.

### Error handling

- Invalid kind/config/output_keys: 400
- Generation not found: 404
- Evaluator execution error: 500 with error message
- Timeout (30s): 504

## Plugin Proxy

```
POST /eval:test → POST /api/v1/eval:test
```

Registered alongside existing eval proxy routes.

## UI Components

### GenerationPicker

Shared, self-contained component for selecting a generation from recent conversations.

**Flow:**
1. Search conversations via existing `POST /query/conversations/search` API
2. Display compact conversation list (ID, model, timestamp, generation count)
3. On conversation select, fetch detail via `GET /query/conversations/{id}`
4. Display generations list (role, model, content preview, timestamp)
5. On generation select, callback with `generation_id`

**Props:** `onSelect: (generationId: string) => void`

Reusable anywhere a generation needs to be picked.

### TestResultDisplay

Renders evaluation score output inline.

Shows: score key, value (formatted by type), pass/fail indicator, explanation text, execution time.

### EvalTestPanel

Composes GenerationPicker + Run button + TestResultDisplay.

**Props:** `kind`, `config`, `outputKeys`, `dataSource`

Reads the parent form's current state so users can edit config, test, edit, test iteratively.

## UI Integration (Phase 1: Templates)

Embed `EvalTestPanel` in:
- **TemplateForm** (create template) — test before creating
- **PublishVersionForm** (publish version) — test before publishing

The panel reads the form's live kind/config/outputKeys state. A "Test" button expands the panel below the config fields.

## Future

- Embed in evaluator create/edit forms (same component, no changes needed)
- Batch test against multiple generations
- Side-by-side comparison of two configs against same generation
