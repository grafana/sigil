import AgentRatingPanel from '../components/agents/AgentRatingPanel';
import type { AgentsDataSource } from '../agents/api';

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
    summary: 'Strong design with minor improvements.',
    suggestions: [
      {
        category: 'tools',
        severity: 'medium',
        title: 'Clarify optional parameters',
        description: 'Document when optional parameters should be provided.',
      },
    ],
    judge_model: 'openai/gpt-4o-mini',
    judge_latency_ms: 280,
  }),
};

const meta = {
  title: 'Sigil/Agents/Prompt and Context Analysis Panel',
  component: AgentRatingPanel,
  args: {
    agentName: 'support-assistant',
    version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    dataSource: mockDataSource,
  },
};

export default meta;

export const Empty = {};

export const Loading = {
  args: {
    initialLoading: true,
  },
};

export const GoodScore = {
  args: {
    initialResult: {
      status: 'completed',
      score: 9,
      summary: 'Excellent overall architecture and prompt quality.',
      suggestions: [
        {
          category: 'formatting',
          severity: 'low',
          title: 'Add one more edge-case example',
          description: 'A single failure-mode example would make behavior even more robust.',
        },
      ],
      judge_model: 'anthropic/claude-sonnet-4-5',
      judge_latency_ms: 190,
    },
  },
};

export const Error = {
  args: {
    initialError: 'Provider timeout: the upstream LLM judge did not respond within 30 seconds.',
  },
};

export const Pending = {
  args: {
    initialLoading: true,
    initialResult: {
      status: 'pending',
      score: 0,
      summary: '',
      suggestions: [],
      judge_model: '',
      judge_latency_ms: 0,
    },
  },
};

export const PoorScoreManySuggestions = {
  args: {
    initialResult: {
      status: 'completed',
      score: 3,
      summary: 'Major issues in prompt clarity and tool design.',
      suggestions: [
        {
          category: 'system_prompt',
          severity: 'high',
          title: 'Define role and operating boundaries',
          description: 'Start with a clear role, responsibilities, and guardrails for unsafe requests.',
        },
        {
          category: 'tools',
          severity: 'high',
          title: 'Reduce overlapping tools',
          description: 'Merge overlapping tools and make each tool purpose explicit.',
        },
        {
          category: 'tools',
          severity: 'medium',
          title: 'Simplify input schemas',
          description: 'Limit top-level parameters and provide clearer parameter descriptions.',
        },
        {
          category: 'tokens',
          severity: 'medium',
          title: 'Shrink context footprint',
          description: 'Reduce long descriptions and move rarely used guidance out of baseline context.',
        },
      ],
      token_warning:
        'Estimated baseline context is 36200 tokens; costs and reliability can degrade above 30000 tokens.',
      judge_model: 'openai/gpt-4o-mini',
      judge_latency_ms: 440,
    },
  },
};

export const LongSummaryClickable = {
  args: {
    initialResult: {
      status: 'completed',
      score: 7,
      summary:
        'The agent is directionally strong, but tool invocation criteria and fallback behavior remain too implicit. Tightening permission language, adding explicit refusal boundaries, and reducing duplicated instruction blocks would improve reliability, safety posture, and token efficiency without changing the user-facing workflow.',
      suggestions: [
        {
          category: 'tools',
          severity: 'medium',
          title: 'Clarify tool eligibility checks',
          description: 'Make preconditions explicit for each tool call and include default fallback paths.',
        },
      ],
      judge_model: 'openai/gpt-4o-mini',
      judge_latency_ms: 320,
    },
  },
};
