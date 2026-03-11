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

  it('quotes label filter values that look like numbers or booleans', () => {
    const filters: DashboardFilters = {
      providers: [],
      models: [],
      agentNames: [],
      labelFilters: [
        { key: 'span.http.status_code', operator: '=', value: '200' },
        { key: 'span.enabled', operator: '=', value: 'true' },
        { key: 'span.port', operator: '!=', value: '8080' },
        { key: 'span.flag', operator: '=', value: 'false' },
      ],
    };

    expect(buildConversationTagDiscoveryQuery(filters)).toBe(
      '{ span.gen_ai.operation.name =~ "generateText|streamText|execute_tool" && span.http.status_code = "200" && span.enabled = "true" && span.port != "8080" && span.flag = "false" }'
    );
  });
});
