import { HighlightedSystemPrompt } from '../components/agents/HighlightedSystemPrompt';
import type { PromptInsightsResponse } from '../agents/types';

const samplePrompt = `You are a helpful coding assistant.

You follow best practices and write clean, maintainable code. Always explain your reasoning step by step before providing a solution.

When the user asks about debugging, use systematic approaches:
1. Reproduce the issue
2. Isolate the root cause
3. Propose a fix with tests

Never execute destructive operations without explicit user confirmation.

If you are unsure about something, ask clarifying questions rather than guessing. Be concise but thorough in your explanations.`;

const sampleInsights: PromptInsightsResponse = {
  status: 'completed',
  strengths: [
    {
      quote: 'Always explain your reasoning step by step before providing a solution',
      title: 'Clear chain-of-thought instruction',
      explanation:
        'Conversations show the agent consistently breaks down problems before coding, leading to higher-quality solutions.',
    },
    {
      quote: 'Never execute destructive operations without explicit user confirmation',
      title: 'Strong safety guardrail',
      explanation:
        'The agent correctly asks for confirmation before delete, drop, or overwrite operations across all sampled conversations.',
    },
    {
      quote: '1. Reproduce the issue\n2. Isolate the root cause\n3. Propose a fix with tests',
      title: 'Structured debugging workflow',
      explanation:
        'When users report bugs, the agent follows this exact sequence, leading to efficient and thorough debugging sessions.',
    },
  ],
  weaknesses: [
    {
      quote: 'Be concise but thorough in your explanations',
      title: 'Contradictory guidance',
      explanation:
        'The tension between "concise" and "thorough" causes inconsistent response lengths across conversations. Some responses are too brief, others too verbose.',
    },
    {
      quote: 'You are a helpful coding assistant',
      title: 'Vague role definition',
      explanation:
        'The role is too generic. Conversations show the agent occasionally drifts into non-coding topics when the boundary is unclear.',
    },
    {
      quote: 'ask clarifying questions rather than guessing',
      title: 'Over-clarification tendency',
      explanation:
        'The agent asks too many clarifying questions even for straightforward requests, slowing down simple tasks.',
    },
  ],
  judge_model: 'openai/gpt-4o-mini',
  judge_latency_ms: 1200,
};

const meta = {
  title: 'Sigil/Agents/Highlighted System Prompt',
  component: HighlightedSystemPrompt,
  args: {
    systemPrompt: samplePrompt,
    insights: sampleInsights,
  },
};

export default meta;

export const WithHighlights = {};

export const WithScrollbarMarkers = {
  args: {
    systemPrompt: samplePrompt,
    insights: sampleInsights,
  },
};

export const NoInsights = {
  args: {
    insights: null,
  },
};

export const EmptyPrompt = {
  args: {
    systemPrompt: '',
    insights: null,
  },
};

export const PendingInsights = {
  args: {
    insights: {
      status: 'pending' as const,
      strengths: [],
      weaknesses: [],
      judge_model: '',
      judge_latency_ms: 0,
    },
  },
};
