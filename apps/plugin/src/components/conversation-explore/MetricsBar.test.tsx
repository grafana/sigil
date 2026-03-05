import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ModelCard } from '../../modelcard/types';
import MetricsBar from './MetricsBar';

const baseCard: ModelCard = {
  model_key: 'openrouter:anthropic/claude-sonnet-4-5',
  source: 'openrouter',
  source_model_id: 'anthropic/claude-sonnet-4-5',
  canonical_slug: 'anthropic/claude-sonnet-4-5',
  name: 'Claude Sonnet 4.5',
  provider: 'anthropic',
  description: 'Balanced Anthropic model.',
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
};

describe('MetricsBar', () => {
  it('opens and closes model card popover when clicking a model chip', () => {
    const modelCards = new Map<string, ModelCard>([['anthropic::claude-sonnet-4-5', baseCard]]);

    render(
      <MetricsBar
        conversationID="conv-1"
        totalDurationMs={2000}
        tokenSummary={null}
        costSummary={null}
        models={['claude-sonnet-4-5']}
        modelProviders={{ 'claude-sonnet-4-5': 'anthropic' }}
        modelCards={modelCards}
        errorCount={0}
        generationCount={1}
      />
    );

    const chip = screen.getByRole('button', { name: /model card claude-sonnet-4-5/i });
    fireEvent.click(chip);

    expect(screen.getByText('Pricing (per 1M tokens)')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('close model card'));

    expect(screen.queryByText('Pricing (per 1M tokens)')).not.toBeInTheDocument();
  });

  it('renders plain model chips when model card data is unavailable', () => {
    render(
      <MetricsBar
        conversationID="conv-2"
        totalDurationMs={1200}
        tokenSummary={null}
        costSummary={null}
        models={['gpt-4o']}
        modelProviders={{ 'gpt-4o': 'openai' }}
        errorCount={0}
        generationCount={1}
      />
    );

    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /model card gpt-4o/i })).not.toBeInTheDocument();
  });

  it('uses provider color mapping for bedrock provider', () => {
    render(
      <MetricsBar
        conversationID="conv-3"
        totalDurationMs={1200}
        tokenSummary={null}
        costSummary={null}
        models={['us.anthropic.claude-haiku-4-5-20251001-v1:0']}
        modelProviders={{ 'us.anthropic.claude-haiku-4-5-20251001-v1:0': 'bedrock' }}
        errorCount={0}
        generationCount={1}
      />
    );

    const chipText = screen.getByText('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    const chip = chipText.closest('span');
    const dot = chip?.querySelector('span');
    expect(dot).toHaveStyle({ background: 'rgb(255, 153, 0)' });
  });

  it('uses vendor color for regional provider values', () => {
    render(
      <MetricsBar
        conversationID="conv-4"
        totalDurationMs={1200}
        tokenSummary={null}
        costSummary={null}
        models={['us.anthropic.claude-haiku-4-5-20251001-v1:0']}
        modelProviders={{ 'us.anthropic.claude-haiku-4-5-20251001-v1:0': 'us.anthropic' }}
        errorCount={0}
        generationCount={1}
      />
    );

    const chipText = screen.getByText('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    const chip = chipText.closest('span');
    const dot = chip?.querySelector('span');
    expect(dot).toHaveStyle({ background: 'rgb(217, 119, 87)' });
  });
});
