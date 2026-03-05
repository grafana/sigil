import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TokenSummary } from '../../conversation/aggregates';
import MetricsBar from './MetricsBar';

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    Tooltip: ({ children, content }: { children: React.ReactNode; content?: React.ReactNode }) => (
      <div>
        {children}
        {content}
      </div>
    ),
  };
});

describe('MetricsBar', () => {
  it('shows cache read and cache write separately in token tooltip content', () => {
    const tokenSummary: TokenSummary = {
      inputTokens: 6100,
      outputTokens: 2000,
      cacheReadTokens: 51119,
      cacheWriteTokens: 22035,
      reasoningTokens: 0,
      totalTokens: 8100,
    };

    render(
      <MetricsBar
        conversationID="conv-cache-test"
        totalDurationMs={1024}
        tokenSummary={tokenSummary}
        costSummary={null}
        models={[]}
        errorCount={0}
        generationCount={1}
      />
    );

    expect(screen.getByText(/In: 6.1k · Out: 2.0k · Cache read: 51.1k · Cache write: 22.0k/)).toBeInTheDocument();
  });
});
