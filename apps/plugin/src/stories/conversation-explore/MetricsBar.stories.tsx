import MetricsBar from '../../components/conversation-explore/MetricsBar';
import { mockTokenSummary, mockCostSummary } from './fixtures';

const meta = {
  title: 'Sigil/Conversation Explore/MetricsBar',
  component: MetricsBar,
};

export default meta;

export const Default = {
  args: {
    conversationID: 'conv-abc-123-def-456',
    totalDurationMs: 8430,
    tokenSummary: mockTokenSummary,
    costSummary: mockCostSummary,
    models: ['claude-sonnet-4-5', 'gpt-4o'],
    modelProviders: { 'claude-sonnet-4-5': 'anthropic', 'gpt-4o': 'openai' },
    errorCount: 0,
    generationCount: 3,
  },
};

export const WithErrors = {
  args: {
    ...Default.args,
    errorCount: 2,
  },
};

export const SingleModel = {
  args: {
    ...Default.args,
    models: ['claude-sonnet-4-5'],
    modelProviders: { 'claude-sonnet-4-5': 'anthropic' },
    generationCount: 1,
    totalDurationMs: 1230,
  },
};

export const NoCost = {
  args: {
    ...Default.args,
    costSummary: null,
  },
};

export const Screenshot = Default;
