import { buildConversationSearchFilter } from './filters';
import type { DashboardFilters } from '../dashboard/types';

const empty: DashboardFilters = {
  providers: [],
  models: [],
  agentNames: [],
  labelFilters: [],
};

describe('buildConversationSearchFilter', () => {
  it('serializes core dashboard filters', () => {
    expect(
      buildConversationSearchFilter({
        ...empty,
        providers: ['openai'],
        models: ['gpt-4o'],
        agentNames: ['assistant'],
      })
    ).toBe('provider = "openai" model = "gpt-4o" agent = "assistant"');
  });

  it('maps dashboard label filters to the best conversation search keys', () => {
    expect(
      buildConversationSearchFilter({
        ...empty,
        labelFilters: [
          { key: 'service_name', operator: '=', value: 'sigil-api' },
          { key: 'gen_ai_operation_name', operator: '=', value: 'streamText' },
          { key: 'k8s_namespace_name', operator: '=', value: 'prod' },
          { key: 'k8s_cluster_name', operator: '=', value: 'blue' },
        ],
      })
    ).toBe(
      'resource.service.name = "sigil-api" operation = "streamText" resource.k8s.namespace.name = "prod" resource.k8s.cluster.name = "blue"'
    );
  });

  it('drops unsupported arbitrary metric labels', () => {
    expect(
      buildConversationSearchFilter({
        ...empty,
        providers: ['openai'],
        labelFilters: [
          { key: 'job', operator: '=', value: 'alloy' },
          { key: 'instance', operator: '=', value: 'localhost:9090' },
          { key: 'service_name', operator: '=', value: 'sigil-api' },
        ],
      })
    ).toBe('provider = "openai" resource.service.name = "sigil-api"');
  });
});
