import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ModelCard } from '../../modelcard/types';
import MetricsBar from './MetricsBar';

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    Tooltip: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
      <span data-testid="tooltip" data-content={typeof content === 'string' ? content : ''}>
        {children}
        {typeof content === 'string' ? null : <span data-testid="tooltip-content">{content}</span>}
      </span>
    ),
  };
});

const modelCard: ModelCard = {
  model_key: 'openrouter:anthropic/claude-sonnet-4.5',
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

const baseProps = {
  conversationID: 'conv-123',
  totalDurationMs: 2340,
  tokenSummary: null,
  costSummary: null,
  models: [],
  errorCount: 0,
  generationCount: 2,
};

const feedbackProps = {
  ratingSummary: {
    total_count: 3,
    good_count: 2,
    bad_count: 1,
    latest_rating: 'CONVERSATION_RATING_VALUE_GOOD' as const,
    has_bad_rating: true,
  },
  recentRatings: [
    {
      rating_id: 'rating-3',
      conversation_id: 'conv-123',
      rating: 'CONVERSATION_RATING_VALUE_GOOD' as const,
      comment: 'Clear answer.',
      created_at: '2026-03-06T10:03:00Z',
    },
    {
      rating_id: 'rating-2',
      conversation_id: 'conv-123',
      rating: 'CONVERSATION_RATING_VALUE_BAD' as const,
      comment: 'Missed the issue.',
      created_at: '2026-03-06T10:02:00Z',
    },
  ],
};

describe('MetricsBar model cards', () => {
  it('opens and closes model card popover when clicking a model chip', () => {
    const modelCards = new Map<string, ModelCard>([['anthropic::claude-sonnet-4-5', modelCard]]);

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

  it('resolves model cards by source model id fallback', () => {
    const modelCards = new Map<string, ModelCard>([['openrouter::anthropic/claude-sonnet-4-5', modelCard]]);

    render(
      <MetricsBar
        conversationID="conv-1"
        totalDurationMs={4200}
        tokenSummary={null}
        costSummary={null}
        models={['anthropic/claude-sonnet-4-5']}
        modelProviders={{ 'anthropic/claude-sonnet-4-5': 'openrouter' }}
        modelCards={modelCards}
        errorCount={0}
        generationCount={1}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /model card anthropic\/claude-sonnet-4-5/i }));

    expect(screen.getByLabelText('close model card')).toBeInTheDocument();
  });

  it('renders model chip disabled when no card is resolved', () => {
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

    expect(screen.getByRole('button', { name: 'model gpt-4o' })).toBeDisabled();
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

    const chip = screen.getByRole('button', { name: 'model us.anthropic.claude-haiku-4-5-20251001-v1:0' });
    const dot = chip.querySelector('span');
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

    const chip = screen.getByRole('button', { name: 'model us.anthropic.claude-haiku-4-5-20251001-v1:0' });
    const dot = chip.querySelector('span');
    expect(dot).toHaveStyle({ background: 'rgb(217, 119, 87)' });
  });
});

describe('MetricsBar conversation title', () => {
  let matchMediaSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    matchMediaSpy = jest.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    matchMediaSpy.mockRestore();
  });

  it('shows conversation id when title is not provided', () => {
    render(<MetricsBar {...baseProps} />);
    expect(screen.getByText('conv-123')).toBeInTheDocument();
    expect(screen.getAllByTestId('tooltip')[0]).toHaveAttribute('data-content', 'conv-123');
  });

  it('types conversation title on mount and keeps tooltip content as full title', () => {
    const title = 'Incident: authentication failures';
    render(<MetricsBar {...baseProps} conversationTitle={title} />);

    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('tooltip')[0]).toHaveAttribute('data-content', title);

    act(() => {
      jest.advanceTimersByTime(title.length * 28 + 100);
    });

    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it('shows user id under the conversation title when provided', () => {
    const title = 'Incident: authentication failures';
    render(<MetricsBar {...baseProps} conversationTitle={title} conversationUserId="jess@example.com" />);

    act(() => {
      jest.advanceTimersByTime(title.length * 28 + 100);
    });

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText('jess@example.com')).toBeInTheDocument();
  });

  it('shows a cost breakdown table in the tooltip', () => {
    render(
      <MetricsBar
        {...baseProps}
        costSummary={{
          inputCost: 0.1,
          outputCost: 0.12,
          cacheReadCost: 0.01,
          cacheWriteCost: 0.03,
          totalCost: 0.26,
        }}
      />
    );

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText('Cache read')).toBeInTheDocument();
    expect(screen.getByText('Cache write')).toBeInTheDocument();
    expect(screen.getAllByText('$0.26')).toHaveLength(2);
  });

  it('shows a token breakdown table in the tooltip', () => {
    render(
      <MetricsBar
        {...baseProps}
        tokenSummary={{
          inputTokens: 1200,
          outputTokens: 800,
          cacheReadTokens: 300,
          cacheWriteTokens: 100,
          reasoningTokens: 0,
          totalTokens: 2400,
        }}
      />
    );

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText('Cache read')).toBeInTheDocument();
    expect(screen.getByText('Cache write')).toBeInTheDocument();
    expect(screen.getAllByText('2.4k')).toHaveLength(2);
    expect(screen.getByText('tokens')).toBeInTheDocument();
  });

  it('shows a calls by agent breakdown table in the tooltip', () => {
    render(
      <MetricsBar
        {...baseProps}
        callsByAgent={[
          { agent: 'assistant', count: 3 },
          { agent: 'planner', count: 1 },
        ]}
      />
    );

    expect(screen.getByText('assistant')).toBeInTheDocument();
    expect(screen.getByText('planner')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('calls')).toBeInTheDocument();
  });

  it('explains the success status badge on hover', () => {
    render(<MetricsBar {...baseProps} />);

    expect(
      screen
        .getAllByTestId('tooltip')
        .find(
          (element) =>
            element.getAttribute('data-content') === 'No generations in this conversation have an error message.'
        )
    ).toHaveAttribute('data-content', 'No generations in this conversation have an error message.');
  });

  it('explains the error status badge on hover', () => {
    render(<MetricsBar {...baseProps} errorCount={2} />);

    expect(
      screen
        .getAllByTestId('tooltip')
        .find(
          (element) =>
            element.getAttribute('data-content') === '2 generations in this conversation have an error message.'
        )
    ).toHaveAttribute('data-content', '2 generations in this conversation have an error message.');
  });

  it('renders compact feedback icons only when counts exist', () => {
    render(<MetricsBar {...baseProps} {...feedbackProps} />);

    expect(screen.getByLabelText('Conversation has good feedback')).toBeInTheDocument();
    expect(screen.getByLabelText('Conversation has bad feedback')).toBeInTheDocument();
  });

  it('shows rating counts and recent details in feedback tooltips', () => {
    render(<MetricsBar {...baseProps} {...feedbackProps} />);

    expect(screen.getByText('Thumbs up')).toBeInTheDocument();
    expect(screen.getByText('Thumbs down')).toBeInTheDocument();
    expect(screen.getAllByText('↑ 2')).toHaveLength(2);
    expect(screen.getAllByText('↓ 1')).toHaveLength(2);
    expect(screen.getByText('Clear answer.')).toBeInTheDocument();
    expect(screen.getByText('Missed the issue.')).toBeInTheDocument();
  });

  it('shows only bad feedback icon when no good ratings exist', () => {
    render(
      <MetricsBar
        {...baseProps}
        ratingSummary={{
          total_count: 1,
          good_count: 0,
          bad_count: 1,
          latest_rating: 'CONVERSATION_RATING_VALUE_BAD',
          has_bad_rating: true,
        }}
        recentRatings={[
          {
            rating_id: 'rating-1',
            conversation_id: 'conv-123',
            rating: 'CONVERSATION_RATING_VALUE_BAD',
            comment: 'Wrong recommendation.',
            created_at: '2026-03-06T10:01:00Z',
          },
        ]}
      />
    );

    expect(screen.queryByLabelText('Conversation has good feedback')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Conversation has bad feedback')).toBeInTheDocument();
  });
});
