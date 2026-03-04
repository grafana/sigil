import { defaultAgentsDataSource } from '../../agents/api';
import type { AgentListItem } from '../../agents/types';
import { countAgentsSeenInWindows, shouldFetchHeroStats } from './LandingTopBar';

const HERO_STATS_STORAGE_KEY = 'grafana-sigil-hero-stats';

describe('countAgentsSeenInWindows', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('paginates agents once for both windows', async () => {
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
    expect(listAgents).toHaveBeenCalledTimes(50);
  });
});

describe('shouldFetchHeroStats', () => {
  afterEach(() => {
    localStorage.removeItem(HERO_STATS_STORAGE_KEY);
  });

  it('returns false when cache is still fresh', () => {
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

    expect(shouldFetchHeroStats(now)).toBe(false);
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
