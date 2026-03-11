import React, { useState } from 'react';
import { LabelFilterInput } from '../components/filters/LabelFilterInput';
import { PROM_LABEL_FILTER_OPERATORS, type LabelFilter } from '../dashboard/types';

const mockLabelValues: Record<string, string[]> = {
  gen_ai_operation_name: ['streamText', 'generateText'],
  service_name: ['sigil-api', 'sigil-worker'],
  job: ['default'],
};

const labelKeyOptions = [
  { label: 'gen_ai_operation_name', value: 'gen_ai_operation_name' },
  { label: 'service_name', value: 'service_name' },
  { label: 'job', value: 'job' },
];

type StoryArgs = Partial<React.ComponentProps<typeof LabelFilterInput>>;

function EmptyWrapper(args?: StoryArgs) {
  const [filters, setFilters] = useState<LabelFilter[]>([]);

  return (
    <LabelFilterInput
      {...args}
      filters={filters}
      labelKeyOptions={labelKeyOptions}
      labelsLoading={false}
      loadValues={async (filter) => (mockLabelValues[filter.key] ?? []).map((value) => ({ label: value, value }))}
      onFiltersChange={setFilters}
    />
  );
}

function WithFiltersWrapper(args?: StoryArgs) {
  const [filters, setFilters] = useState<LabelFilter[]>([
    { key: 'service_name', operator: '!=', value: 'sigil-worker' },
    { key: 'gen_ai_operation_name', operator: '=', value: 'streamText' },
  ]);

  return (
    <LabelFilterInput
      {...args}
      filters={filters}
      labelKeyOptions={labelKeyOptions}
      labelsLoading={false}
      loadValues={async (filter) => (mockLabelValues[filter.key] ?? []).map((value) => ({ label: value, value }))}
      onFiltersChange={setFilters}
    />
  );
}

const meta = {
  title: 'Filters/LabelFilterInput',
  component: LabelFilterInput,
};

export default meta;

export const Empty = {
  render: (args: StoryArgs) => <EmptyWrapper {...args} />,
};

export const WithFilters = {
  render: (args: StoryArgs) => <WithFiltersWrapper {...args} />,
};

export const PrometheusOnlyOperators = {
  render: (args: StoryArgs) => <WithFiltersWrapper {...args} />,
  args: {
    allowedOperators: PROM_LABEL_FILTER_OPERATORS,
  },
};
