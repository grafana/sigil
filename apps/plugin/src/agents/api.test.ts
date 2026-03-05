import { of, throwError } from 'rxjs';
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

  it('lookupAgentRating requests persisted rating route', async () => {
    fetchMock.mockReturnValue(
      of({
        data: {
          score: 7,
          summary: 'Good baseline.',
          suggestions: [],
          judge_model: 'openai/gpt-4o-mini',
          judge_latency_ms: 42,
        },
      })
    );

    const result = await defaultAgentsDataSource.lookupAgentRating(
      'assistant',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );

    expect(fetchMock).toHaveBeenCalledWith({
      method: 'GET',
      url: '/api/plugins/grafana-sigil-app/resources/query/agents/rating?name=assistant&version=sha256%3Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(result?.score).toBe(7);
  });

  it('lookupAgentRating returns null when no persisted rating exists', async () => {
    fetchMock.mockReturnValue(
      throwError(() => ({
        status: 404,
        data: { message: 'not found' },
      }))
    );

    const result = await defaultAgentsDataSource.lookupAgentRating('assistant');
    expect(result).toBeNull();
  });

  it('rateAgent posts to async rating endpoint', async () => {
    fetchMock.mockReturnValue(
      of({
        data: {
          status: 'pending',
          score: 0,
          summary: '',
          suggestions: [],
          judge_model: '',
          judge_latency_ms: 0,
        },
      })
    );

    const result = await defaultAgentsDataSource.rateAgent(
      'assistant',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );

    expect(fetchMock).toHaveBeenCalledWith({
      method: 'POST',
      url: '/api/plugins/grafana-sigil-app/resources/query/agents/rate',
      data: {
        agent_name: 'assistant',
        version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });
    expect(result.status).toBe('pending');
  });
});
