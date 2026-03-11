import { buildConversationTagDiscoveryQuery } from './searchTagScope';
import type { DashboardFilters } from '../dashboard/types';

describe('buildConversationTagDiscoveryQuery', () => {
  it('scopes discovery to conversation generation and tool-use spans', () => {
    expect(buildConversationTagDiscoveryQuery()).toBe(
      '{ span.gen_ai.operation.name =~ "generateText|streamText|execute_tool" }'
    );
  });

  it('adds current conversation filters to the discovery query', () => {
    const filters: DashboardFilters = {
      providers: ['openai'],
      models: ['gpt-4o'],
      agentNames: ['assistant'],
      labelFilters: [{ key: 'resource.k8s.namespace.name', operator: '=', value: 'prod' }],
    };

    expect(buildConversationTagDiscoveryQuery(filters)).toBe(
      '{ span.gen_ai.operation.name =~ "generateText|streamText|execute_tool" && span.gen_ai.provider.name = "openai" && span.gen_ai.request.model = "gpt-4o" && span.gen_ai.agent.name = "assistant" && resource.k8s.namespace.name = "prod" }'
    );
  });
});
