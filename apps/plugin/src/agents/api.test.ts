import { of } from 'rxjs';
import { defaultAgentsDataSource } from './api';

const fetchMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({
    fetch: fetchMock,
  }),
}));

describe('defaultAgentsDataSource', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('listAgents builds query params', async () => {
    fetchMock.mockReturnValue(
      of({
        data: {
          items: [],
          next_cursor: 'next',
        },
      })
    );

    await defaultAgentsDataSource.listAgents(25, 'cursor-1', 'assist');

    expect(fetchMock).toHaveBeenCalledWith({
      method: 'GET',
      url: '/api/plugins/grafana-sigil-app/resources/query/agents?limit=25&cursor=cursor-1&name_prefix=assist',
    });
  });

  it('lookupAgent sends required name query key for anonymous bucket', async () => {
    fetchMock.mockReturnValue(
      of({
        data: {
          agent_name: '',
          effective_version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          first_seen_at: '',
          last_seen_at: '',
          generation_count: 0,
          system_prompt: '',
          system_prompt_prefix: '',
          tool_count: 0,
          token_estimate: { system_prompt: 0, tools_total: 0, total: 0 },
          tools: [],
          models: [],
        },
      })
    );

    await defaultAgentsDataSource.lookupAgent('');

    expect(fetchMock).toHaveBeenCalledWith({
      method: 'GET',
      url: '/api/plugins/grafana-sigil-app/resources/query/agents/lookup?name=',
    });
  });

  it('listAgentVersions requests versions route', async () => {
    fetchMock.mockReturnValue(
      of({
        data: {
          items: [],
          next_cursor: '',
        },
      })
    );

    await defaultAgentsDataSource.listAgentVersions('assistant', 10, 'cursor-2');

    expect(fetchMock).toHaveBeenCalledWith({
      method: 'GET',
      url: '/api/plugins/grafana-sigil-app/resources/query/agents/versions?name=assistant&limit=10&cursor=cursor-2',
    });
  });
});
