import { defaultAgentsDataSource } from '../../agents/api';
import type { AgentListItem } from '../../agents/types';
import { countAgentsSeenInWindows } from './LandingTopBar';

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
