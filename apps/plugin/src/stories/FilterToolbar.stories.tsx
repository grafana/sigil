import React, { useState } from 'react';
import { makeTimeRange, type TimeRange } from '@grafana/data';
import { FilterToolbar } from '../components/filters/FilterToolbar';
import { type DashboardFilters, emptyFilters } from '../dashboard/types';
import type { DashboardDataSource } from '../dashboard/api';
import { MemoryRouter } from 'react-router-dom';

const mockLabelValues: Record<string, string[]> = {
  gen_ai_operation_name: ['streamText', 'generateText'],
  service_name: ['sigil-api', 'sigil-worker'],
  job: ['default'],
};

const mockDataSource: DashboardDataSource = {
  async queryRange() {
    return { status: 'success', data: { resultType: 'matrix', result: [] } };
  },
  async queryInstant() {
    return { status: 'success', data: { resultType: 'vector', result: [] } };
  },
  async labels() {
    return Object.keys(mockLabelValues);
  },
  async labelValues(label) {
    return mockLabelValues[label] ?? [];
  },
  async resolveModelCards() {
    return {
      resolved: [],
      freshness: {
        catalog_last_refreshed_at: null,
        stale: false,
        soft_stale: false,
        hard_stale: false,
        source_path: 'memory_live',
      },
    };
  },
};

const now = Math.floor(Date.now() / 1000);
const oneHourAgo = now - 3600;

type StoryArgs = Partial<React.ComponentProps<typeof FilterToolbar>>;

function DefaultWrapper(args?: StoryArgs) {
  const [timeRange, setTimeRange] = useState<TimeRange>(() =>
    makeTimeRange('2026-02-15T08:00:00.000Z', '2026-02-15T12:00:00.000Z')
  );
  const [filters, setFilters] = useState<DashboardFilters>(emptyFilters);

  return (
    <FilterToolbar
      {...args}
      timeRange={timeRange}
      filters={filters}
      providerOptions={['openai', 'anthropic', 'google']}
      modelOptions={['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-20250514']}
      agentOptions={['my-chatbot', 'code-assistant', 'data-analyzer']}
      labelKeyOptions={['gen_ai_operation_name', 'service_name', 'job']}
      labelsLoading={false}
      dataSource={mockDataSource}
      from={oneHourAgo}
      to={now}
      onTimeRangeChange={setTimeRange}
      onFiltersChange={setFilters}
    />
  );
}

function WithActiveFiltersWrapper(args?: StoryArgs) {
  const [timeRange, setTimeRange] = useState<TimeRange>(() =>
    makeTimeRange('2026-02-15T08:00:00.000Z', '2026-02-15T12:00:00.000Z')
  );
  const [filters, setFilters] = useState<DashboardFilters>({
    providers: ['openai'],
    models: ['gpt-4o'],
    agentNames: ['my-chatbot'],
    labelFilters: [{ key: 'service_name', operator: '=~', value: 'sigil.*' }],
  });

  return (
    <FilterToolbar
      {...args}
      timeRange={timeRange}
      filters={filters}
      providerOptions={['openai', 'anthropic', 'google']}
      modelOptions={['gpt-4o', 'gpt-4o-mini']}
      agentOptions={['my-chatbot', 'code-assistant']}
      labelKeyOptions={['gen_ai_operation_name', 'service_name', 'job']}
      labelsLoading={false}
      dataSource={mockDataSource}
      from={oneHourAgo}
      to={now}
      onTimeRangeChange={setTimeRange}
      onFiltersChange={setFilters}
    />
  );
}

const meta = {
  title: 'Filters/FilterToolbar',
  component: FilterToolbar,
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export default meta;

export const Default = {
  render: (args: StoryArgs) => <DefaultWrapper {...args} />,
};

export const WithActiveFilters = {
  render: (args: StoryArgs) => <WithActiveFiltersWrapper {...args} />,
};

export const ExpandedLabelFilters = {
  render: (args: StoryArgs) => <WithActiveFiltersWrapper {...args} />,
  args: {
    defaultShowLabelFilterRow: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Expanded label filters render as a second row with spacing only and no separator line.',
      },
    },
  },
};

export const HiddenLabelFilters = {
  render: (args: StoryArgs) => <WithActiveFiltersWrapper {...args} />,
  args: {
    hideLabelFilters: true,
  },
};
