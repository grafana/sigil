import GenerationsList from '../components/conversations/GenerationsList';
import type { DashboardDataSource } from '../dashboard/api';
import { mockConversationDetail, mockGenerationDetail, mockGenerationWithError } from './mockConversationData';

const meta = {
  title: 'Sigil/Conversations/GenerationsList',
  component: GenerationsList,
};

export default meta;

const storyPricingDataSource: DashboardDataSource = {
  async queryRange() {
    throw new Error('queryRange is not used in GenerationsList stories');
  },
  async queryInstant() {
    throw new Error('queryInstant is not used in GenerationsList stories');
  },
  async labels() {
    return [];
  },
  async labelValues() {
    return [];
  },
  async resolveModelCards(pairs) {
    return {
      resolved: pairs.map((pair) => ({
        provider: pair.provider,
        model: pair.model,
        status: 'resolved' as const,
        match_strategy: 'exact' as const,
        card: {
          model_key: `${pair.provider}:${pair.model}`,
          source_model_id: pair.model,
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
      })),
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'storybook',
      },
    };
  },
};

export const Default = {
  args: {
    generations: mockConversationDetail.generations,
    pricingDataSource: storyPricingDataSource,
  },
};

export const WithErrors = {
  args: {
    generations: [...mockConversationDetail.generations, mockGenerationWithError],
    pricingDataSource: storyPricingDataSource,
  },
};

export const WithRenderedMessages = {
  args: {
    generations: [mockGenerationDetail, mockGenerationWithError],
    pricingDataSource: storyPricingDataSource,
  },
};

export const Empty = {
  args: {
    generations: [],
    pricingDataSource: storyPricingDataSource,
  },
};
