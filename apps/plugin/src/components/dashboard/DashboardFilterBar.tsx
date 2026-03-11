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
  providerOptions: string[];
  modelOptions: string[];
  agentOptions: string[];
  labelKeyOptions: string[];
  labelsLoading?: boolean;
  dataSource: DashboardDataSource;
  from: number;
  to: number;
  showLabelFilters?: boolean;
  showLabelFilterRow?: boolean;
  onLabelFilterRowOpenChange?: (isOpen: boolean) => void;
  onTimeRangeChange: (timeRange: TimeRange) => void;
  onFiltersChange: (filters: DashboardFilters) => void;
  onBreakdownChange: (breakdown: BreakdownDimension) => void;
};

const breakdownOptions: Array<SelectableValue<BreakdownDimension>> = (
  Object.keys(breakdownLabel) as BreakdownDimension[]
).map((key) => ({ label: breakdownLabel[key], value: key }));

export function DashboardFilterBar({
  timeRange,
  filters,
  breakdownBy,
  providerOptions,
  modelOptions,
  agentOptions,
  labelKeyOptions,
  labelsLoading = false,
  dataSource,
  from,
  to,
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
      onTimeRangeChange={onTimeRangeChange}
      onFiltersChange={onFiltersChange}
      hideLabelFilters={!showLabelFilters}
      fillWidth
      labelFilterOperators={PROM_LABEL_FILTER_OPERATORS}
      showLabelFilterRow={showLabelFilterRow}
      onLabelFilterRowOpenChange={onLabelFilterRowOpenChange}
    >
      <Select<BreakdownDimension>
        options={breakdownOptions}
        value={breakdownBy === 'none' ? null : breakdownBy}
        onChange={handleBreakdownChange}
        placeholder="Breakdown by"
        prefix={breakdownBy !== 'none' ? 'Breakdown by' : undefined}
        width={28}
      />
    </FilterToolbar>
  );
}
