import { defaultAgentsDataSource } from '../../agents/api';
import { countAgentsSeenInWindows } from './LandingTopBar';

describe('countAgentsSeenInWindows', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('paginates agents once for both windows', async () => {
    const listAgents = jest.spyOn(defaultAgentsDataSource, 'listAgents').mockImplementation(async () => ({
      items: [{ latest_seen_at: '2026-03-04T11:00:00Z' }],
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
