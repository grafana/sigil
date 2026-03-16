import React, { useCallback } from 'react';
import { Select } from '@grafana/ui';
import { type SelectableValue, type TimeRange } from '@grafana/data';
import {
  type BreakdownDimension,
  breakdownLabel,
  type DashboardFilters,
  PROM_LABEL_FILTER_OPERATORS,
} from '../../dashboard/types';
import type { DashboardDataSource } from '../../dashboard/api';
import { FilterToolbar } from '../filters/FilterToolbar';

export type DashboardFilterBarProps = {
  timeRange: TimeRange;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  breakdownOptions?: Array<SelectableValue<BreakdownDimension>>;
  providerOptions: string[];
  modelOptions: string[];
  agentOptions: string[];
  labelKeyOptions: string[];
  labelsLoading?: boolean;
  dataSource: DashboardDataSource;
  from: number;
  to: number;
  hideBreakdown?: boolean;
  hideProviderFilter?: boolean;
  hideModelFilter?: boolean;
  showLabelFilters?: boolean;
  showLabelFilterRow?: boolean;
  onLabelFilterRowOpenChange?: (isOpen: boolean) => void;
  onTimeRangeChange: (timeRange: TimeRange) => void;
  onFiltersChange: (filters: DashboardFilters) => void;
  onBreakdownChange: (breakdown: BreakdownDimension) => void;
};

const defaultBreakdownOptions: Array<SelectableValue<BreakdownDimension>> = [
  { label: breakdownLabel.none, value: 'none' },
  { label: breakdownLabel.provider, value: 'provider' },
  { label: breakdownLabel.model, value: 'model' },
  { label: breakdownLabel.agent, value: 'agent' },
];

export function DashboardFilterBar({
  timeRange,
  filters,
  breakdownBy,
  breakdownOptions = defaultBreakdownOptions,
  providerOptions,
  modelOptions,
  agentOptions,
  labelKeyOptions,
  labelsLoading = false,
  dataSource,
  from,
  to,
  hideBreakdown = false,
  hideProviderFilter = false,
  hideModelFilter = false,
  showLabelFilters = true,
  showLabelFilterRow,
  onLabelFilterRowOpenChange,
  onTimeRangeChange,
  onFiltersChange,
  onBreakdownChange,
}: DashboardFilterBarProps) {
  const handleBreakdownChange = useCallback(
    (value: SelectableValue<BreakdownDimension>) => {
      onBreakdownChange(value?.value ?? 'none');
    },
    [onBreakdownChange]
  );

  return (
    <FilterToolbar
      timeRange={timeRange}
      filters={filters}
      providerOptions={providerOptions}
      modelOptions={modelOptions}
      agentOptions={agentOptions}
      labelKeyOptions={labelKeyOptions}
      labelsLoading={labelsLoading}
      dataSource={dataSource}
      from={from}
      to={to}
      hideProviderFilter={hideProviderFilter}
      hideModelFilter={hideModelFilter}
      onTimeRangeChange={onTimeRangeChange}
      onFiltersChange={onFiltersChange}
      hideLabelFilters={!showLabelFilters}
      fillWidth
      labelFilterOperators={PROM_LABEL_FILTER_OPERATORS}
      showLabelFilterRow={showLabelFilterRow}
      onLabelFilterRowOpenChange={onLabelFilterRowOpenChange}
    >
      {!hideBreakdown && (
        <Select<BreakdownDimension>
          options={breakdownOptions}
          value={breakdownBy === 'none' ? null : breakdownBy}
          onChange={handleBreakdownChange}
          placeholder="Breakdown by"
          prefix={breakdownBy !== 'none' ? 'Breakdown by' : undefined}
          width={28}
        />
      )}
    </FilterToolbar>
  );
}
