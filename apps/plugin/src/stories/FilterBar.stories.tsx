import React, { useState } from 'react';
import FilterBar from '../components/FilterBar';
import type { SearchTag } from '../conversation/types';

const mockTags: SearchTag[] = [
  { key: 'model', scope: 'well-known', description: 'Model name' },
  { key: 'agent', scope: 'well-known', description: 'Agent name' },
  { key: 'status', scope: 'well-known', description: 'Error status' },
  { key: 'duration', scope: 'well-known', description: 'Generation duration' },
  { key: 'resource.k8s.namespace.name', scope: 'resource' },
  { key: 'span.gen_ai.usage.input_tokens', scope: 'span' },
];

function FilterBarStoryWrapper() {
  const [filter, setFilter] = useState<string>('model = "gpt-4o"');
  const [from, setFrom] = useState<string>('2026-02-15T08:00:00.000Z');
  const [to, setTo] = useState<string>('2026-02-15T12:00:00.000Z');

  return (
    <FilterBar
      filter={filter}
      from={from}
      to={to}
      tags={mockTags}
      tagValues={['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-5']}
      loadingTags={false}
      loadingValues={false}
      onFilterChange={setFilter}
      onFromChange={setFrom}
      onToChange={setTo}
      onApply={() => {
        // Storybook interaction-only callback.
      }}
      onRequestTagValues={() => {
        // Storybook interaction-only callback.
      }}
    />
  );
}

const meta = {
  title: 'Sigil/Filter Bar',
  component: FilterBar,
  render: () => <FilterBarStoryWrapper />,
};

export default meta;
export const Default = {};
