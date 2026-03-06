import { PromptDiffView } from '../components/agents/PromptDiffView';

const oldPrompt = `You are a helpful coding assistant.

Always explain your reasoning step by step before providing a solution.

When debugging:
1. Reproduce the issue
2. Propose a fix

Never execute destructive operations.`;

const newPrompt = `You are an expert coding assistant specializing in TypeScript and Go.

Always explain your reasoning step by step before providing a solution.

When debugging:
1. Reproduce the issue
2. Isolate the root cause
3. Propose a fix with tests

Never execute destructive operations without explicit user confirmation.

If unsure, ask clarifying questions.`;

const meta = {
  title: 'Sigil/Agents/Prompt Diff View',
  component: PromptDiffView,
  args: {
    oldPrompt,
    newPrompt,
  },
};

export default meta;

export const Default = {};

export const WithLabels = {
  args: {
    oldLabel: 'v1.0.0',
    newLabel: 'v2.0.0',
  },
};

export const NoChanges = {
  args: {
    oldPrompt: 'Same prompt content.\nLine two.',
    newPrompt: 'Same prompt content.\nLine two.',
  },
};

export const LargeAddition = {
  args: {
    oldPrompt: 'Short old prompt.',
    newPrompt: `Short old prompt.

## New section

This is a new section that was added.
It contains multiple lines of content.
Each line provides additional guidance.

### Sub-section

More details here.`,
  },
};

export const LargeDeletion = {
  args: {
    oldPrompt: `Full prompt with many lines.

## Section to remove

This section will be removed.
It has several lines.
All will show as deleted.

## Remaining section

This stays.`,
    newPrompt: `Full prompt with many lines.

## Remaining section

This stays.`,
  },
};
