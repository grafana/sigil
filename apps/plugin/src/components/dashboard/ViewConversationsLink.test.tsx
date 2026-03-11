import { makeTimeRange } from '@grafana/data';
import { buildConversationsUrl } from './ViewConversationsLink';
import type { DashboardFilters } from '../../dashboard/types';

const timeRange = makeTimeRange('2026-03-11T09:00:00.000Z', '2026-03-11T10:00:00.000Z');

describe('buildConversationsUrl', () => {
  it('only carries provider, model, and agent filters into conversations', () => {
    const filters: DashboardFilters = {
      providers: ['openai'],
      models: ['gpt-4o'],
      agentNames: ['assistant'],
      labelFilters: [
        { key: 'service_name', operator: '=', value: 'sigil-api' },
        { key: 'k8s_namespace_name', operator: '=', value: 'prod' },
        { key: 'job', operator: '=', value: 'alloy' },
      ],
    };

    const url = buildConversationsUrl(timeRange, filters, 'time');
    const params = new URLSearchParams(url.split('?')[1]);

    expect(params.getAll('provider')).toEqual(['openai']);
    expect(params.getAll('model')).toEqual(['gpt-4o']);
    expect(params.getAll('agent')).toEqual(['assistant']);
    expect(params.getAll('label')).toEqual([]);
  });
});
