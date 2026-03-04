import React, { useState } from 'react';
import { LabelFilterInput } from '../components/filters/LabelFilterInput';
import type { LabelFilter } from '../dashboard/types';
import type { DashboardDataSource } from '../dashboard/api';

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

const labelKeyOptions = [
  { label: 'gen_ai_operation_name', value: 'gen_ai_operation_name' },
  { label: 'service_name', value: 'service_name' },
  { label: 'job', value: 'job' },
];

function EmptyWrapper() {
  const [filters, setFilters] = useState<LabelFilter[]>([]);

  return (
    <LabelFilterInput
      filters={filters}
      labelKeyOptions={labelKeyOptions}
      labelsLoading={false}
      dataSource={mockDataSource}
      from={oneHourAgo}
      to={now}
      onChange={(index, updated) => {
        setFilters((prev) => {
          const next = [...prev];
          if (index >= next.length) {
            next.push(updated);
          } else {
            next[index] = updated;
          }
          return next;
        });
      }}
      onRemove={(index) => {
        setFilters((prev) => prev.filter((_, i) => i !== index));
      }}
    />
  );
}

function WithFiltersWrapper() {
  const [filters, setFilters] = useState<LabelFilter[]>([
    { key: 'service_name', operator: '!=', value: 'sigil-worker' },
    { key: 'gen_ai_operation_name', operator: '=', value: 'streamText' },
  ]);

  return (
    <LabelFilterInput
      filters={filters}
      labelKeyOptions={labelKeyOptions}
      labelsLoading={false}
      dataSource={mockDataSource}
      from={oneHourAgo}
      to={now}
      onChange={(index, updated) => {
        setFilters((prev) => {
          const next = [...prev];
          if (index >= next.length) {
            next.push(updated);
          } else {
            next[index] = updated;
          }
          return next;
        });
      }}
      onRemove={(index) => {
        setFilters((prev) => prev.filter((_, i) => i !== index));
      }}
    />
  );
}

const meta = {
  title: 'Filters/LabelFilterInput',
  component: LabelFilterInput,
};

export default meta;

export const Empty = {
  render: () => <EmptyWrapper />,
};

export const WithFilters = {
  render: () => <WithFiltersWrapper />,
};
