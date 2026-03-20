---
title: Set up online evaluation
menuTitle: Score quality
description: Create evaluators and rules to continuously score agent quality on live production traffic.
keywords:
  - Sigil
  - evaluation
  - quality
  - LLM judge
  - scoring
weight: 5
---

# Set up online evaluation

Online evaluation lets you score your agents' live production traffic automatically. This guide walks you through creating your first evaluator and rule.

## Before you begin

- The eval worker is enabled (`SIGIL_EVAL_WORKER_ENABLED=true`).
- At least one judge provider is configured. Refer to [Configure evaluation](../../configure/evaluation/) for provider setup.
- You have the Sigil Admin role.

## Create an evaluator

1. Navigate to **Evaluation** in the Sigil plugin.
1. Click **Create evaluator**.
1. Choose an evaluator type:
   - **LLM judge** — scores responses using an LLM.
   - **JSON schema** — validates response structure.
   - **Regex** — matches response patterns.
   - **Heuristic** — applies rule-based checks.
1. Configure the evaluator settings.
1. Click **Save**.

### Write an LLM judge prompt

For an LLM judge evaluator, write a prompt that describes the scoring criteria. Use template variables to inject generation data:

```text
You are evaluating the quality of an AI assistant response.

User message:
{{latest_user_message}}

Assistant response:
{{assistant_response}}

Rate the response quality on a scale of 1-5, where 1 is poor and 5 is excellent.
Consider accuracy, helpfulness, and clarity.

Return only the numeric score.
```

## Create a rule

Rules connect evaluators to generation traffic:

1. In **Evaluation**, click **Create rule**.
1. Choose a selector:
   - **User visible turn** — assistant text responses without tool calls.
   - **All assistant generations** — any assistant output.
   - **Tool call steps** — generations containing tool calls.
   - **Errored generations** — generations with errors.
1. Set a sampling rate (for example, 10% to evaluate 1 in 10 matching generations).
1. Attach your evaluator.
1. Click **Save**.

## Monitor results

Evaluation scores appear in three places:

- **Conversation detail**: scores displayed next to each evaluated generation.
- **Evaluation dashboard**: aggregate score distributions, trends, and failure rates.
- **Analytics dashboards**: quality metrics alongside cost and performance data.

Use the evaluation dashboard to identify quality regressions after prompt changes, compare evaluator results across agent versions, and spot patterns in low-scoring generations.

## Next steps

- [Use built-in dashboards](../dashboards/)
- [Configure evaluator types](../../configure/evaluation/)
