import React from 'react';
import { render } from '@testing-library/react';
import { makeTimeRange } from '@grafana/data';
import { DashboardFilterBar } from './DashboardFilterBar';
import { PROM_LABEL_FILTER_OPERATORS, emptyFilters } from '../../dashboard/types';
import type { DashboardDataSource } from '../../dashboard/api';

const mockFilterToolbar = jest.fn<void, [unknown]>();

jest.mock('../filters/FilterToolbar', () => ({
  FilterToolbar: (props: unknown) => {
    mockFilterToolbar(props);
    return null;
  },
}));

const mockDataSource: DashboardDataSource = {
  async queryRange() {
    return { status: 'success', data: { resultType: 'matrix', result: [] } };
  },
  async queryInstant() {
    return { status: 'success', data: { resultType: 'vector', result: [] } };
  },
  async labels() {
    return [];
  },
  async labelValues() {
    return [];
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

describe('DashboardFilterBar', () => {
  const timeRange = makeTimeRange('2026-02-15T08:00:00.000Z', '2026-02-15T12:00:00.000Z');

  beforeEach(() => {
    mockFilterToolbar.mockClear();
  });

  function renderToolbar(showLabelFilters = true) {
    render(
      <DashboardFilterBar
        timeRange={timeRange}
        filters={emptyFilters}
        breakdownBy="agent"
        providerOptions={['openai']}
        modelOptions={['gpt-4o']}
        agentOptions={['assistant']}
        labelKeyOptions={['service_name']}
        labelsLoading={false}
        dataSource={mockDataSource}
        from={1}
        to={2}
        showLabelFilters={showLabelFilters}
        showLabelFilterRow
        onLabelFilterRowOpenChange={jest.fn()}
        onTimeRangeChange={jest.fn()}
        onFiltersChange={jest.fn()}
        onBreakdownChange={jest.fn()}
      />
    );
  }

  it('shows arbitrary label filters on core analytics tabs', () => {
    renderToolbar(true);

    expect(mockFilterToolbar).toHaveBeenCalledWith(
      expect.objectContaining({
        hideLabelFilters: false,
        labelFilterOperators: PROM_LABEL_FILTER_OPERATORS,
        showLabelFilterRow: true,
        onLabelFilterRowOpenChange: expect.any(Function),
      })
    );
  });

  it('hides arbitrary label filters outside the supported analytics tabs', () => {
    renderToolbar(false);

    expect(mockFilterToolbar).toHaveBeenCalledWith(
      expect.objectContaining({
        hideLabelFilters: true,
        labelFilterOperators: PROM_LABEL_FILTER_OPERATORS,
        showLabelFilterRow: true,
        onLabelFilterRowOpenChange: expect.any(Function),
      })
    );
  });
});
