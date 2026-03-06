import type { ModelCard } from '../../modelcard/types';
import MetricsBar from '../../components/conversation-explore/MetricsBar';
import { mockTokenSummary, mockCostSummary } from './fixtures';

const storyModelCards = new Map<string, ModelCard>([
  [
    'anthropic::claude-sonnet-4-5',
    {
      model_key: 'openrouter:anthropic/claude-sonnet-4-5',
      source: 'openrouter',
      source_model_id: 'anthropic/claude-sonnet-4-5',
      canonical_slug: 'anthropic/claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      provider: 'anthropic',
      description: "Anthropic's balanced Claude model.",
      context_length: 200000,
      input_modalities: ['text'],
      output_modalities: ['text'],
      pricing: {
        prompt_usd_per_token: 0.000003,
        completion_usd_per_token: 0.000015,
        request_usd: null,
        image_usd: null,
        web_search_usd: null,
        input_cache_read_usd_per_token: 0.0000003,
        input_cache_write_usd_per_token: 0.00000375,
      },
      is_free: false,
      top_provider: {
        context_length: 200000,
        max_completion_tokens: 64000,
      },
      first_seen_at: '2026-01-01T00:00:00Z',
      last_seen_at: '2026-03-01T00:00:00Z',
      refreshed_at: '2026-03-01T00:00:00Z',
    },
  ],
  [
    'openai::gpt-4o',
    {
      model_key: 'openrouter:openai/gpt-4o',
      source: 'openrouter',
      source_model_id: 'openai/gpt-4o',
      canonical_slug: 'openai/gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      description: 'OpenAI flagship model.',
      context_length: 128000,
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
      pricing: {
        prompt_usd_per_token: 0.0000025,
        completion_usd_per_token: 0.00001,
        request_usd: null,
        image_usd: null,
        web_search_usd: null,
        input_cache_read_usd_per_token: 0.00000125,
        input_cache_write_usd_per_token: 0.0000025,
      },
      is_free: false,
      top_provider: {
        context_length: 128000,
        max_completion_tokens: 16384,
      },
      first_seen_at: '2026-01-01T00:00:00Z',
      last_seen_at: '2026-03-01T00:00:00Z',
      refreshed_at: '2026-03-01T00:00:00Z',
    },
  ],
]);

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
    modelCards: storyModelCards,
    errorCount: 0,
    generationCount: 3,
    onBack: () => {},
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
    conversationTitle: 'Incident: authentication failures in eu-west-1',
    isSaved: true,
    onToggleSave: () => {},
  },
};

export const UnsavedConversation = {
  args: {
    ...Default.args,
    conversationTitle: 'Incident: authentication failures in eu-west-1',
    isSaved: false,
    onToggleSave: () => {},
  },
};

export const WithConversationTitle = {
  args: {
    ...Default.args,
    conversationTitle: 'Incident: authentication failures in eu-west-1',
  },
};

export const WithFeedback = {
  args: {
    ...Default.args,
    ratingSummary: {
      total_count: 3,
      good_count: 2,
      bad_count: 1,
      latest_rating: 'CONVERSATION_RATING_VALUE_GOOD',
      has_bad_rating: true,
    },
    recentRatings: [
      {
        rating_id: 'rating-3',
        conversation_id: 'conv-abc-123-def-456',
        rating: 'CONVERSATION_RATING_VALUE_GOOD',
        comment: 'Clear answer.',
        created_at: '2026-03-06T10:03:00Z',
      },
      {
        rating_id: 'rating-2',
        conversation_id: 'conv-abc-123-def-456',
        rating: 'CONVERSATION_RATING_VALUE_BAD',
        comment: 'Missed the actual problem.',
        created_at: '2026-03-06T10:02:00Z',
      },
      {
        rating_id: 'rating-1',
        conversation_id: 'conv-abc-123-def-456',
        rating: 'CONVERSATION_RATING_VALUE_GOOD',
        comment: 'Useful trace summary.',
        created_at: '2026-03-06T10:01:00Z',
      },
    ],
  },
};

export const Screenshot = Default;

export const WithModelCardPopover = {
  args: {
    ...Default.args,
    models: ['claude-sonnet-4-5'],
    modelProviders: { 'claude-sonnet-4-5': 'anthropic' },
    modelCards: new Map<string, ModelCard>([
      ['anthropic::claude-sonnet-4-5', storyModelCards.get('anthropic::claude-sonnet-4-5')!],
    ]),
  },
};
