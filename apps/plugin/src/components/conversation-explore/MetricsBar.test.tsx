import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import MetricsBar from './MetricsBar';
import type { ModelCard } from '../../modelcard/types';

const modelCard: ModelCard = {
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

describe('MetricsBar', () => {
  it('opens model card popover when model chip has a resolved card', () => {
    const cards = new Map<string, ModelCard>([['anthropic::claude-sonnet-4-5', modelCard]]);

    render(
      <MetricsBar
        conversationID="conv-1"
        totalDurationMs={4200}
        tokenSummary={null}
        costSummary={null}
        models={['claude-sonnet-4-5']}
        modelProviders={{ 'claude-sonnet-4-5': 'anthropic' }}
        modelCards={cards}
        errorCount={0}
        generationCount={1}
      />
    );

    const chipButton = screen.getByRole('button', { name: 'model card claude-sonnet-4-5' });
    fireEvent.click(chipButton);

    expect(screen.getByLabelText('close model card')).toBeInTheDocument();
  });

  it('renders model chip disabled when no card is resolved', () => {
    render(
      <MetricsBar
        conversationID="conv-1"
        totalDurationMs={4200}
        tokenSummary={null}
        costSummary={null}
        models={['claude-sonnet-4-5']}
        modelProviders={{ 'claude-sonnet-4-5': 'anthropic' }}
        errorCount={0}
        generationCount={1}
      />
    );

    expect(screen.getByRole('button', { name: 'model claude-sonnet-4-5' })).toBeDisabled();
  });
});
