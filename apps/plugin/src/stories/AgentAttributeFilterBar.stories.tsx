import React, { useState } from 'react';
import { AgentAttributeFilterBar } from '../components/filters/AgentAttributeFilterBar';
import type { AgentAttributeFilter } from '../agents/types';

const tagOptions = [
  { label: 'resource.k8s.namespace.name', value: 'resource.k8s.namespace.name' },
  { label: 'resource.k8s.cluster.name', value: 'resource.k8s.cluster.name' },
  { label: 'resource.service.name', value: 'resource.service.name' },
  { label: 'span.sigil.conversation.id', value: 'span.sigil.conversation.id' },
  { label: 'span.gen_ai.agent.name', value: 'span.gen_ai.agent.name' },
];

const tagValues: Record<string, string[]> = {
  'resource.k8s.namespace.name': ['prod', 'staging', 'dev'],
  'resource.k8s.cluster.name': ['cluster-a', 'cluster-b'],
  'resource.service.name': ['sigil-api', 'sigil-worker'],
  'span.sigil.conversation.id': ['conv-1', 'conv-2'],
  'span.gen_ai.agent.name': ['assistant', 'builder'],
};

function StoryWrapper({ initialFilters }: { initialFilters: AgentAttributeFilter[] }) {
  const [filters, setFilters] = useState<AgentAttributeFilter[]>(initialFilters);

  return (
    <div style={{ maxWidth: 960 }}>
      <AgentAttributeFilterBar
        filters={filters}
        tagOptions={tagOptions}
        tagsLoading={false}
        loadTagValues={async (tag) => tagValues[tag] ?? []}
        onChange={setFilters}
      />
    </div>
  );
}

const meta = {
  title: 'Filters/AgentAttributeFilterBar',
  component: AgentAttributeFilterBar,
};

export default meta;

export const Empty = {
  render: () => <StoryWrapper initialFilters={[]} />,
};

export const WithFilters = {
  render: () => (
    <StoryWrapper
      initialFilters={[
        { key: 'resource.k8s.namespace.name', operator: '=', value: 'prod' },
        { key: 'resource.service.name', operator: '!=', value: 'sigil-worker' },
      ]}
    />
  ),
};
