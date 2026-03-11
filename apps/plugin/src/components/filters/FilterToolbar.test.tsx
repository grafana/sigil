import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeTimeRange } from '@grafana/data';
import { FilterToolbar } from './FilterToolbar';
import type { DashboardDataSource } from '../../dashboard/api';
import type { DashboardFilters } from '../../dashboard/types';

jest.mock('./LabelFilterInput', () => ({
  LabelFilterInput: ({ onDismiss }: { onDismiss?: () => void }) => (
    <div data-testid="label-filter-input">
      <div>Label filter editor</div>
      {onDismiss && (
        <button type="button" aria-label="Hide label filters" onClick={onDismiss}>
          Hide
        </button>
      )}
    </div>
  ),
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

const emptyFilters: DashboardFilters = {
  providers: [],
  models: [],
  agentNames: [],
  labelFilters: [],
};

describe('FilterToolbar', () => {
  const timeRange = makeTimeRange('2026-02-15T08:00:00.000Z', '2026-02-15T12:00:00.000Z');

  function renderToolbar(filters: DashboardFilters = emptyFilters) {
    render(
      <FilterToolbar
        timeRange={timeRange}
        filters={filters}
        providerOptions={['openai']}
        modelOptions={['gpt-4o']}
        agentOptions={['assistant']}
        labelKeyOptions={['service_name']}
        labelsLoading={false}
        dataSource={mockDataSource}
        from={1}
        to={2}
        onTimeRangeChange={jest.fn()}
        onFiltersChange={jest.fn()}
      />
    );
  }

  it('moves arbitrary label filters into a second row when toggled open', () => {
    renderToolbar();

    expect(screen.getByLabelText('Show label filters')).toBeInTheDocument();
    expect(screen.queryByText('Label filter editor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Show label filters'));

    expect(screen.queryByLabelText('Show label filters')).not.toBeInTheDocument();
    expect(screen.getByText('Label filter editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Hide label filters')).toBeInTheDocument();
  });

  it('renders the expanded label filter row without a separator border', () => {
    renderToolbar();

    fireEvent.click(screen.getByLabelText('Show label filters'));

    const row = screen.getByTestId('label-filter-row');
    const rule = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .find(
        (candidate) =>
          candidate instanceof CSSStyleRule &&
          Array.from(row.classList).some((name) => candidate.selectorText?.includes(`.${name}`))
      );

    expect(rule).toBeInstanceOf(CSSStyleRule);
    expect((rule as CSSStyleRule).style.getPropertyValue('border-top')).toBe('');
    expect(screen.getByTestId('label-filter-input')).toBeInTheDocument();
  });

  it('shows active label filter summary while the second row is collapsed', () => {
    renderToolbar({
      ...emptyFilters,
      labelFilters: [{ key: 'service_name', operator: '=', value: 'sigil-api' }],
    });

    expect(screen.getByText('1 label filter active')).toBeInTheDocument();
    expect(screen.queryByText('Label filter editor')).not.toBeInTheDocument();
  });

  it('hides label filter toggle and editor when hideLabelFilters is true', () => {
    render(
      <FilterToolbar
        timeRange={timeRange}
        filters={{
          ...emptyFilters,
          labelFilters: [{ key: 'service_name', operator: '=', value: 'sigil-api' }],
        }}
        providerOptions={['openai']}
        modelOptions={['gpt-4o']}
        agentOptions={['assistant']}
        labelKeyOptions={['service_name']}
        labelsLoading={false}
        dataSource={mockDataSource}
        from={1}
        to={2}
        hideLabelFilters
        onTimeRangeChange={jest.fn()}
        onFiltersChange={jest.fn()}
      />
    );

    expect(screen.queryByLabelText('Show label filters')).not.toBeInTheDocument();
    expect(screen.queryByText('Label filter editor')).not.toBeInTheDocument();
  });

  it('shows active label filter badge when hideLabelFilters is true and filters are active', () => {
    render(
      <FilterToolbar
        timeRange={timeRange}
        filters={{
          ...emptyFilters,
          labelFilters: [{ key: 'service_name', operator: '=', value: 'sigil-api' }],
        }}
        providerOptions={['openai']}
        modelOptions={['gpt-4o']}
        agentOptions={['assistant']}
        labelKeyOptions={['service_name']}
        labelsLoading={false}
        dataSource={mockDataSource}
        from={1}
        to={2}
        hideLabelFilters
        onTimeRangeChange={jest.fn()}
        onFiltersChange={jest.fn()}
      />
    );

    expect(screen.getByText('1 label filter active')).toBeInTheDocument();
  });
});
