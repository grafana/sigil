import PromptInsightsPanel from '../components/agents/PromptInsightsPanel';
import type { AgentsDataSource } from '../agents/api';
import type { PromptInsightsResponse } from '../agents/types';

const completedInsights: PromptInsightsResponse = {
  status: 'completed',
  strengths: [
    {
      quote: 'Always explain your reasoning',
      title: 'Clear chain-of-thought instruction',
      explanation: 'Conversations show the agent consistently provides reasoning before solutions.',
    },
    {
      quote: 'Never execute destructive operations',
      title: 'Strong safety guardrail',
      explanation: 'The agent correctly asks for confirmation before dangerous operations.',
    },
    {
      quote: 'Reproduce the issue, isolate the root cause',
      title: 'Structured debugging workflow',
      explanation: 'Bug reports are handled methodically following this sequence.',
    },
  ],
  weaknesses: [
    {
      quote: 'Be concise but thorough',
      title: 'Contradictory guidance',
      explanation: 'Response lengths are inconsistent due to the tension between conciseness and thoroughness.',
    },
    {
      quote: 'helpful coding assistant',
      title: 'Vague role definition',
      explanation: 'The agent occasionally drifts into non-coding topics.',
    },
    {
      quote: 'ask clarifying questions',
      title: 'Over-clarification tendency',
      explanation: 'Too many clarifying questions for straightforward requests.',
    },
  ],
  judge_model: 'openai/gpt-4o-mini',
  judge_latency_ms: 1200,
};

const mockDataSource: AgentsDataSource = {
  listAgents: async () => ({ items: [], next_cursor: '' }),
  lookupAgent: async () => {
    throw new globalThis.Error('not implemented');
  },
  listAgentVersions: async () => ({ items: [], next_cursor: '' }),
  lookupAgentRating: async () => null,
  rateAgent: async () => ({
    status: 'completed',
    score: 8,
    summary: 'Good.',
    suggestions: [],
    judge_model: '',
    judge_latency_ms: 0,
  }),
  lookupPromptInsights: async () => null,
  analyzePrompt: async () => completedInsights,
};

const cachedDataSource: AgentsDataSource = {
  ...mockDataSource,
  lookupPromptInsights: async () => completedInsights,
};

const meta = {
  title: 'Sigil/Agents/Prompt Insights Panel',
  component: PromptInsightsPanel,
  args: {
    agentName: 'support-assistant',
    version: 'sha256:abc123',
    dataSource: mockDataSource,
  },
};

export default meta;

export const Empty = {};

export const WithCachedResult = {
  args: {
    dataSource: cachedDataSource,
  },
};

export const HideControls = {
  args: {
    dataSource: cachedDataSource,
    hideControls: true,
  },
};
