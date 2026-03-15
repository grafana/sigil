import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { dateTimeParse, type TimeRange } from '@grafana/data';
import { DashboardConsumptionGrid } from './DashboardConsumptionGrid';
import type { DashboardDataSource } from '../../dashboard/api';
import type { ConversationsDataSource } from '../../conversation/api';
import { emptyFilters, type PrometheusQueryResponse } from '../../dashboard/types';
import { formatStatValue } from './dashboardShared';

jest.mock('./MetricPanel', () => ({
  MetricPanel: ({ title }: { title: string }) => <div>{title}</div>,
}));

jest.mock('../insight/PageInsightBar', () => ({
  PageInsightBar: () => <div data-testid="page-insight-bar" />,
}));

jest.mock('../shared/DataTable', () => ({
  __esModule: true,
  default: ({ panelTitle }: { panelTitle?: string }) => <div>{panelTitle ?? 'data-table'}</div>,
  getCommonCellStyles: () => ({}),
}));

jest.mock('./dashboardShared', () => {
  const actual = jest.requireActual('./dashboardShared');
  return {
    ...actual,
    BreakdownStatPanel: ({ title }: { title: string }) => <div>{title}</div>,
  };
});

jest.mock('./DashboardSummaryBar', () => ({
  DashboardSummaryBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('./ViewConversationsLink', () => ({
  ViewConversationsLink: () => null,
}));

jest.mock('./ViewAgentsLink', () => ({
  buildAgentDetailHref: undefined,
}));

jest.mock('./useModelCardBreakdownPopover', () => ({
  useModelCardBreakdownPopover: () => ({ onModelClick: undefined, modelPopoverElement: null }),
}));

function makeVectorResponse(
  results: Array<{ labels: Record<string, string>; value: string }>
): PrometheusQueryResponse {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: results.map((result) => ({
        metric: result.labels,
        value: [0, result.value] as [number, string],
      })),
    },
  };
}

function makeMatrixResponse(): PrometheusQueryResponse {
  return {
    status: 'success',
    data: {
      resultType: 'matrix',
      result: [],
    },
  };
}

function createDashboardDataSource(): DashboardDataSource {
  return {
    queryRange: jest.fn(async () => makeMatrixResponse()),
    queryInstant: jest.fn(async (query: string) => {
      if (query.includes('gen_ai_request_model') && query.includes('gen_ai_token_type')) {
        return makeVectorResponse([
          {
            labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'input' },
            value: '100',
          },
          {
            labels: { gen_ai_provider_name: 'openai', gen_ai_request_model: 'gpt-4o', gen_ai_token_type: 'output' },
            value: '40',
          },
        ]);
      }

      if (query.includes('gen_ai_token_type=~"input"')) {
        return makeVectorResponse([{ labels: {}, value: '100' }]);
      }
      if (query.includes('gen_ai_token_type=~"output"')) {
        return makeVectorResponse([{ labels: {}, value: '40' }]);
      }
      if (query.includes('gen_ai_token_type=~"cache_read"')) {
        return makeVectorResponse([{ labels: {}, value: '10' }]);
      }
      if (query.includes('by (gen_ai_token_type)')) {
        return makeVectorResponse([
          { labels: { gen_ai_token_type: 'input' }, value: '100' },
          { labels: { gen_ai_token_type: 'output' }, value: '40' },
        ]);
      }
      if (query.includes('token_usage')) {
        return makeVectorResponse([{ labels: {}, value: '150' }]);
      }

      return makeVectorResponse([{ labels: {}, value: '0' }]);
    }),
    labels: jest.fn(async () => []),
    labelValues: jest.fn(async () => []),
    resolveModelCards: jest.fn(async (pairs) => ({
      resolved: pairs.map(({ provider, model }) => ({
        provider,
        model,
        status: 'resolved' as const,
        match_strategy: 'exact' as const,
        card: {
          model_key: 'openai:gpt-4o',
          source_model_id: 'openai/gpt-4o',
          pricing: {
            prompt_usd_per_token: 0.01,
            completion_usd_per_token: 0.02,
            request_usd: null,
            image_usd: null,
            web_search_usd: null,
            input_cache_read_usd_per_token: null,
            input_cache_write_usd_per_token: null,
          },
        },
      })),
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    })),
  };
}

function createConversationsDataSource(): ConversationsDataSource {
  let statsCall = 0;

  return {
    listConversations: jest.fn(async () => ({ items: [] })),
    searchConversations: jest.fn(async () => ({
      conversations: [],
      next_cursor: '',
      has_more: false,
    })),
    getConversationDetail: jest.fn(async () => {
      throw new Error('not used in DashboardConsumptionGrid test');
    }),
    getGeneration: jest.fn(async () => {
      throw new Error('not used in DashboardConsumptionGrid test');
    }),
    getSearchTags: jest.fn(async () => []),
    getSearchTagValues: jest.fn(async () => []),
    getConversationStats: jest.fn(async () => {
      statsCall += 1;
      if (statsCall === 1) {
        return {
          totalConversations: 2,
          totalTokens: 140,
          avgCallsPerConversation: 2,
          activeLast7d: 2,
          ratedConversations: 1,
          badRatedPct: 0,
        };
      }
      return {
        totalConversations: 1,
        totalTokens: 80,
        avgCallsPerConversation: 1,
        activeLast7d: 1,
        ratedConversations: 0,
        badRatedPct: 0,
      };
    }),
  };
}

describe('DashboardConsumptionGrid', () => {
  it('shows average cost stats alongside the total estimated cost', async () => {
    const timeRange: TimeRange = {
      from: dateTimeParse('2026-02-01T09:00:00Z'),
      to: dateTimeParse('2026-02-01T10:00:00Z'),
      raw: { from: 'now-1h', to: 'now' },
    };

    render(
      <DashboardConsumptionGrid
        dataSource={createDashboardDataSource()}
        conversationsDataSource={createConversationsDataSource()}
        filters={emptyFilters}
        breakdownBy="none"
        from={Math.floor(timeRange.from.valueOf() / 1000)}
        to={Math.floor(timeRange.to.valueOf() / 1000)}
        timeRange={timeRange}
        onTimeRangeChange={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText(formatStatValue(1.8, 'currencyUSD'))).toBeInTheDocument());
    expect(screen.getByText('Avg Cost / Conversation')).toBeInTheDocument();
    expect(screen.getByText('Avg Cost / Call')).toBeInTheDocument();
    expect(screen.getByText(formatStatValue(0.9, 'currencyUSD'))).toBeInTheDocument();
    expect(screen.getByText(formatStatValue(0.45, 'currencyUSD'))).toBeInTheDocument();
  });
});
