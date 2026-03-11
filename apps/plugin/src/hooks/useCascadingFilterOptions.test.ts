import { renderHook, waitFor } from '@testing-library/react';
import { useCascadingFilterOptions } from './useCascadingFilterOptions';
import type { DashboardDataSource } from '../dashboard/api';
import type { DashboardFilters } from '../dashboard/types';

const emptyFilters: DashboardFilters = {
  providers: [],
  models: [],
  agentNames: [],
  labelFilters: [],
};

function createDataSource(): DashboardDataSource {
  return {
    queryRange: jest.fn().mockResolvedValue({ status: 'success', data: { resultType: 'matrix', result: [] } }),
    queryInstant: jest.fn().mockResolvedValue({ status: 'success', data: { resultType: 'vector', result: [] } }),
    labels: jest
      .fn()
      .mockResolvedValue([
        'service_name',
        'job',
        'gen_ai_provider_name',
        'gen_ai_request_model',
        'gen_ai_agent_name',
        '__name__',
      ]),
    labelValues: jest.fn().mockImplementation(async (label: string) => {
      switch (label) {
        case 'gen_ai_provider_name':
          return ['openai', 'anthropic'];
        case 'gen_ai_request_model':
          return ['gpt-4o'];
        case 'gen_ai_agent_name':
          return ['assistant'];
        default:
          return [];
      }
    }),
    resolveModelCards: jest.fn().mockResolvedValue({
      resolved: [],
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    }),
  };
}

describe('useCascadingFilterOptions', () => {
  it('excludes provider, model, and agent from arbitrary label key options', async () => {
    const dataSource = createDataSource();
    const { result } = renderHook(() => useCascadingFilterOptions(dataSource, emptyFilters, 1, 2));

    await waitFor(() => {
      expect(result.current.labelsLoading).toBe(false);
    });

    expect(result.current.providerOptions).toEqual(['openai', 'anthropic']);
    expect(result.current.modelOptions).toEqual(['gpt-4o']);
    expect(result.current.agentOptions).toEqual(['assistant']);
    expect(result.current.labelKeyOptions).toEqual(['job', 'service_name']);
    expect(result.current.labelKeyOptions).not.toContain('gen_ai_provider_name');
    expect(result.current.labelKeyOptions).not.toContain('gen_ai_request_model');
    expect(result.current.labelKeyOptions).not.toContain('gen_ai_agent_name');
  });
});
