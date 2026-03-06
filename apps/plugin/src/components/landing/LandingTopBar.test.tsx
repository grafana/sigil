import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { defaultAgentsDataSource } from '../../agents/api';
import type { AgentListItem } from '../../agents/types';
import { defaultConversationsDataSource } from '../../conversation/api';
import { defaultEvaluationDataSource } from '../../evaluation/api';
import {
  LandingTopBar,
  buildRequestSpineCacheKey,
  countAgentsSeenInWindows,
  shouldFetchHeroStats,
} from './LandingTopBar';

const mockOpenAssistant = jest.fn();
jest.mock('@grafana/assistant', () => ({
  useAssistant: () => ({
    openAssistant: mockOpenAssistant,
  }),
  createAssistantContextItem: jest.fn((_type: string, params: { title?: string }) => ({
    node: {
      id: 'sigil-context',
      name: params.title ?? 'Sigil knowledgebase',
      navigable: false,
      selectable: true,
      data: { type: 'structured' },
    },
    occurrences: [],
  })),
}));

jest.mock('../../conversation/api', () => ({
  defaultConversationsDataSource: {
    searchConversations: jest.fn(async () => ({
      conversations: [],
      has_more: false,
      next_cursor: '',
    })),
  },
}));

jest.mock('../../agents/api', () => ({
  defaultAgentsDataSource: {
    listAgents: jest.fn(async () => ({
      items: [],
      next_cursor: '',
    })),
  },
}));

jest.mock('../../evaluation/api', () => ({
  defaultEvaluationDataSource: {
    listEvaluators: jest.fn(async () => ({
      items: [],
      next_cursor: '',
    })),
  },
}));

const HERO_STATS_STORAGE_KEY = 'grafana-sigil-hero-stats';

describe('countAgentsSeenInWindows', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockOpenAssistant.mockReset();
  });

  it('caps agent pagination when counting both windows', async () => {
    const agent: AgentListItem = {
      agent_name: 'agent-1',
      latest_effective_version: 'v1',
      first_seen_at: '2026-03-01T11:00:00Z',
      latest_seen_at: '2026-03-04T11:00:00Z',
      generation_count: 1,
      version_count: 1,
      tool_count: 0,
      system_prompt_prefix: '',
      token_estimate: {
        system_prompt: 0,
        tools_total: 0,
        total: 0,
      },
    };

    const listAgents = jest.spyOn(defaultAgentsDataSource, 'listAgents').mockImplementation(async () => ({
      items: [agent],
      next_cursor: 'cursor-next',
    }));

    const now = new Date('2026-03-04T12:00:00Z');
    const currentFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const previousFrom = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const previousTo = currentFrom;

    const counts = await countAgentsSeenInWindows(currentFrom, now, previousFrom, previousTo);

    expect(counts.current).toBeGreaterThan(0);
    expect(listAgents).toHaveBeenCalledTimes(10);
  });
});

describe('shouldFetchHeroStats', () => {
  afterEach(() => {
    localStorage.removeItem(HERO_STATS_STORAGE_KEY);
  });

  it('returns true when cache is still fresh to revalidate in background', () => {
    const now = new Date('2026-03-04T12:00:00Z').getTime();
    localStorage.setItem(
      HERO_STATS_STORAGE_KEY,
      JSON.stringify({
        fetched_at: now - 30_000,
        conversations: { current: 12, previous: 10 },
        agents: { current: 8, previous: 6 },
        evaluations: { current: 3, previous: 2 },
      })
    );

    expect(shouldFetchHeroStats(now)).toBe(true);
  });

  it('returns true when cache is stale or missing timestamp', () => {
    const now = new Date('2026-03-04T12:00:00Z').getTime();
    localStorage.setItem(
      HERO_STATS_STORAGE_KEY,
      JSON.stringify({
        fetched_at: now - 10 * 60_000,
        conversations: { current: 12, previous: 10 },
        agents: { current: 8, previous: 6 },
        evaluations: { current: 3, previous: 2 },
      })
    );
    expect(shouldFetchHeroStats(now)).toBe(true);

    localStorage.setItem(
      HERO_STATS_STORAGE_KEY,
      JSON.stringify({
        conversations: { current: 12, previous: 10 },
        agents: { current: 8, previous: 6 },
        evaluations: { current: 3, previous: 2 },
      })
    );
    expect(shouldFetchHeroStats(now)).toBe(true);
  });
});

describe('buildRequestSpineCacheKey', () => {
  it('reuses cache key across quick refreshes for same query and duration', () => {
    const query = 'sum(rate(http_requests_total[5m]))';
    const fromA = 1_700_000_000;
    const toA = 1_700_021_600;
    const fromB = 1_700_000_060;
    const toB = 1_700_021_660;

    expect(buildRequestSpineCacheKey(query, fromA, toA, 48)).toBe(buildRequestSpineCacheKey(query, fromB, toB, 48));
  });
});

describe('LandingTopBar hero stats polling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('recomputes the hero stats time window on each poll interval', async () => {
    jest.setSystemTime(new Date('2026-03-05T12:00:00Z'));

    const searchConversations = jest.spyOn(defaultConversationsDataSource, 'searchConversations');
    jest.spyOn(defaultAgentsDataSource, 'listAgents');
    jest.spyOn(defaultEvaluationDataSource, 'listEvaluators');

    await act(async () => {
      render(
        <MemoryRouter>
          <LandingTopBar assistantOrigin="test-origin" />
        </MemoryRouter>
      );
    });

    await waitFor(() => {
      expect(searchConversations).toHaveBeenCalledTimes(2);
    });

    const firstCurrentFrom = Date.parse(searchConversations.mock.calls[0][0].time_range.from);
    const firstCurrentTo = Date.parse(searchConversations.mock.calls[0][0].time_range.to);

    await act(async () => {
      jest.advanceTimersByTime(70_000);
    });

    await waitFor(() => {
      expect(searchConversations).toHaveBeenCalledTimes(4);
    });

    const secondCurrentFrom = Date.parse(searchConversations.mock.calls[2][0].time_range.from);
    const secondCurrentTo = Date.parse(searchConversations.mock.calls[2][0].time_range.to);

    expect(secondCurrentFrom).toBeGreaterThan(firstCurrentFrom);
    expect(secondCurrentTo).toBeGreaterThan(firstCurrentTo);
    expect(secondCurrentFrom - firstCurrentFrom).toBe(70_000);
    expect(secondCurrentTo - firstCurrentTo).toBe(70_000);
  });
});

describe('LandingTopBar assistant context', () => {
  afterEach(() => {
    mockOpenAssistant.mockReset();
  });

  it('sends user prompt and structured context separately', async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <LandingTopBar assistantOrigin="test-origin" />
        </MemoryRouter>
      );
    });

    const assistantInput = screen.getByRole('textbox');
    fireEvent.change(assistantInput, {
      target: { value: 'How does Sigil work?' },
    });
    fireEvent.submit(assistantInput.closest('form')!);

    expect(mockOpenAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'test-origin',
        autoSend: true,
        prompt: 'How does Sigil work?',
        context: expect.arrayContaining([
          expect.objectContaining({
            node: expect.objectContaining({
              name: 'Sigil knowledgebase',
            }),
          }),
        ]),
      })
    );
  });

  it('submits prompt when pressing Enter in the assistant input', async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <LandingTopBar assistantOrigin="test-origin" />
        </MemoryRouter>
      );
    });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, {
      target: { value: 'Tell me about Sigil' },
    });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    expect(mockOpenAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'test-origin',
        autoSend: true,
        prompt: 'Tell me about Sigil',
      })
    );
  });
});
