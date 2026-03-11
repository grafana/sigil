import type { LabelFilter } from '../dashboard/types';
import {
  canonicalizeConversationFilterKey,
  mapDashboardLabelFiltersToConversation,
  resolveConversationFilterKey,
} from './filterKeyMapping';

const filters = (items: LabelFilter[]): LabelFilter[] => items;

describe('filterKeyMapping', () => {
  it('keeps exact mappings for provider, model, agent, and operation', () => {
    expect(resolveConversationFilterKey('gen_ai_provider_name')).toBe('provider');
    expect(resolveConversationFilterKey('gen_ai_request_model')).toBe('model');
    expect(resolveConversationFilterKey('gen_ai_agent_name')).toBe('agent');
    expect(resolveConversationFilterKey('gen_ai_operation_name')).toBe('operation');
  });

  it('best-effort matches common metric labels to conversation filter keys', () => {
    expect(resolveConversationFilterKey('service_name')).toBe('resource.service.name');
    expect(resolveConversationFilterKey('k8s_namespace_name')).toBe('resource.k8s.namespace.name');
    expect(resolveConversationFilterKey('k8s_cluster_name')).toBe('resource.k8s.cluster.name');
  });

  it('canonicalizes conversation aliases to concrete resource attributes', () => {
    expect(canonicalizeConversationFilterKey('service')).toBe('resource.service.name');
    expect(canonicalizeConversationFilterKey('namespace')).toBe('resource.k8s.namespace.name');
    expect(canonicalizeConversationFilterKey('cluster')).toBe('resource.k8s.cluster.name');
    expect(canonicalizeConversationFilterKey('resource.namespace')).toBe('resource.k8s.namespace.name');
    expect(canonicalizeConversationFilterKey('resource.cluster')).toBe('resource.k8s.cluster.name');
  });

  it('resolves alias-like keys to concrete conversation attributes', () => {
    expect(resolveConversationFilterKey('cluster')).toBe('resource.k8s.cluster.name');
    expect(resolveConversationFilterKey('namespace')).toBe('resource.k8s.namespace.name');
    expect(resolveConversationFilterKey('resource.namespace')).toBe('resource.k8s.namespace.name');
  });

  it('keeps explicit span and resource attribute keys', () => {
    expect(resolveConversationFilterKey('resource.service.name')).toBe('resource.service.name');
    expect(resolveConversationFilterKey('resource.sigil.devex.language')).toBe('resource.sigil.devex.language');
    expect(resolveConversationFilterKey('span.http.route')).toBe('span.http.route');
  });

  it('drops label filters without a confident match', () => {
    expect(
      mapDashboardLabelFiltersToConversation(
        filters([
          { key: 'job', operator: '=', value: 'alloy' },
          { key: 'instance', operator: '=', value: 'localhost:9090' },
          { key: 'service_name', operator: '=', value: 'sigil-api' },
        ])
      )
    ).toEqual(filters([{ key: 'resource.service.name', operator: '=', value: 'sigil-api' }]));
  });
});
