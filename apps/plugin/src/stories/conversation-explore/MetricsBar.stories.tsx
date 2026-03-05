import MetricsBar from '../../components/conversation-explore/MetricsBar';
import type { ModelCard } from '../../modelcard/types';
import { mockTokenSummary, mockCostSummary } from './fixtures';

const demoModelCard: ModelCard = {
  model_key: 'openrouter:anthropic/claude-sonnet-4.5',
  source: 'openrouter',
  source_model_id: 'anthropic/claude-sonnet-4.5',
  canonical_slug: 'anthropic/claude-sonnet-4-5',
  name: 'claude-sonnet-4-5',
  provider: 'anthropic',
  pricing: {
    prompt_usd_per_token: 0.000003,
    completion_usd_per_token: 0.000015,
    request_usd: null,
    image_usd: null,
    web_search_usd: null,
    input_cache_read_usd_per_token: null,
    input_cache_write_usd_per_token: null,
  },
  is_free: false,
  top_provider: {},
  first_seen_at: '2026-01-01T00:00:00Z',
  last_seen_at: '2026-01-01T00:00:00Z',
  refreshed_at: '2026-01-01T00:00:00Z',
};

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

export const SavedConversation = {
  args: {
    ...Default.args,
    isSaved: true,
    onToggleSave: () => {},
  },
};

export const UnsavedConversation = {
  args: {
    ...Default.args,
    isSaved: false,
    onToggleSave: () => {},
  },
};

export const Screenshot = Default;

export const WithModelCardPopover = {
  args: {
    ...Default.args,
    modelCards: new Map<string, ModelCard>([['anthropic::claude-sonnet-4-5', demoModelCard]]),
  },
};
