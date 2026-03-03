import GenerationItem from '../components/conversations/GenerationItem';
import { buildPricingMap } from '../dashboard/cost';
import { mockGenerationDetail, mockGenerationWithError } from './mockConversationData';

const meta = {
  title: 'Sigil/Conversations/GenerationItem',
  component: GenerationItem,
};

export default meta;

const resolvedPricing = buildPricingMap([
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    pricing: {
      prompt_usd_per_token: 0.003,
      completion_usd_per_token: 0.015,
      request_usd: null,
      image_usd: null,
      web_search_usd: null,
      input_cache_read_usd_per_token: 0.0003,
      input_cache_write_usd_per_token: 0.00375,
    },
  },
]);

export const Default = {
  args: {
    generation: mockGenerationDetail,
    index: 0,
    total: 2,
    resolvedPricing,
  },
};

export const WithError = {
  args: {
    generation: mockGenerationWithError,
    index: 1,
    total: 2,
    resolvedPricing,
  },
};
