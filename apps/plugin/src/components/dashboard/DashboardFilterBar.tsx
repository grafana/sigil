import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { TimeRangeInput, Select, Stack, Button, Badge, IconButton, useStyles2 } from '@grafana/ui';
import { type GrafanaTheme2, type SelectableValue, type TimeRange } from '@grafana/data';
import {
  type BreakdownDimension,
  breakdownLabel,
  type DashboardFilters,
  type LabelFilter,
} from '../../dashboard/types';
import type { DashboardDataSource } from '../../dashboard/api';
import { useLabelValues } from './useLabelValues';

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
  onTimeRangeChange: (timeRange: TimeRange) => void;
  onFiltersChange: (filters: DashboardFilters) => void;
  onBreakdownChange: (breakdown: BreakdownDimension) => void;
};

const breakdownOptions: Array<SelectableValue<BreakdownDimension>> = (
  Object.keys(breakdownLabel) as BreakdownDimension[]
).map((key) => ({ label: breakdownLabel[key], value: key }));

type LabelFilterRowProps = {
  filter: LabelFilter;
  index: number;
  labelKeyOptions: Array<SelectableValue<string>>;
  labelsLoading: boolean;
  dataSource: DashboardDataSource;
  from: number;
  to: number;
  onChange: (index: number, filter: LabelFilter) => void;
  onRemove: (index: number) => void;
};

function LabelFilterRow({
  filter,
  index,
  labelKeyOptions,
  labelsLoading,
  dataSource,
  from,
  to,
  onChange,
  onRemove,
}: LabelFilterRowProps) {
  const styles = useStyles2(getStyles);
  const { values: valueOptions, loading: valuesLoading } = useLabelValues(dataSource, filter.key, from, to);
  const valueSelectOptions = useMemo(() => valueOptions.map((v) => ({ label: v, value: v })), [valueOptions]);

  const handleKeyChange = useCallback(
    (sel: SelectableValue<string>) => {
      onChange(index, { key: sel?.value ?? '', value: '' });
    },
    [index, onChange]
  );

  const handleValueChange = useCallback(
    (sel: SelectableValue<string>) => {
      onChange(index, { ...filter, value: sel?.value ?? '' });
    },
    [index, filter, onChange]
  );

  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [index, onRemove]);

  return (
    <Stack direction="row" gap={0.5} alignItems="center">
      <Select<string>
        options={labelKeyOptions}
        value={filter.key || null}
        onChange={handleKeyChange}
        placeholder="Select label"
        isClearable
        isLoading={labelsLoading}
        isSearchable
        width={18}
      />
      <span className={styles.operatorBadge}>=</span>
      <Select<string>
        options={valueSelectOptions}
        value={filter.value || null}
        onChange={handleValueChange}
        placeholder="Select value"
        isClearable
        disabled={!filter.key}
        isLoading={valuesLoading}
        isSearchable
        width={18}
      />
      <IconButton name="times" aria-label="Remove filter" size="md" onClick={handleRemove} />
    </Stack>
  );
}

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
  onTimeRangeChange,
  onFiltersChange,
  onBreakdownChange,
}: DashboardFilterBarProps) {
  const styles = useStyles2(getStyles);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Incomplete label filter rows (user clicked + but hasn't filled both key and value)
  // are tracked locally so they aren't lost when the URL round-trips.
  const [pendingRows, setPendingRows] = useState<LabelFilter[]>([]);
  const draftLabelFilters = useMemo(
    () => [...filters.labelFilters, ...pendingRows],
    [filters.labelFilters, pendingRows]
  );

  const syncLabelFilters = useCallback(
    (nextAll: LabelFilter[]) => {
      const complete: LabelFilter[] = [];
      const incomplete: LabelFilter[] = [];
      for (const lf of nextAll) {
        if (lf.key && lf.value) {
          complete.push(lf);
        } else {
          incomplete.push(lf);
        }
      }
      setPendingRows(incomplete);
      onFiltersChange({ ...filters, labelFilters: complete });
    },
    [filters, onFiltersChange]
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.provider) {
      count++;
    }
    if (filters.model) {
      count++;
    }
    if (filters.agentName) {
      count++;
    }
    count += filters.labelFilters.filter((lf) => lf.key && lf.value).length;
    return count;
  }, [filters]);

  const handleProviderChange = useCallback(
    (value: SelectableValue<string>) => {
      onFiltersChange({ ...filters, provider: value?.value ?? '', model: '', agentName: '' });
    },
    [filters, onFiltersChange]
  );
  const handleProviderCreate = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, provider: value.trim(), model: '', agentName: '' });
    },
    [filters, onFiltersChange]
  );

  const handleModelChange = useCallback(
    (value: SelectableValue<string>) => {
      onFiltersChange({ ...filters, model: value?.value ?? '', agentName: '' });
    },
    [filters, onFiltersChange]
  );
  const handleModelCreate = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, model: value.trim(), agentName: '' });
    },
    [filters, onFiltersChange]
  );

  const handleAgentChange = useCallback(
    (value: SelectableValue<string>) => {
      onFiltersChange({ ...filters, agentName: value?.value ?? '' });
    },
    [filters, onFiltersChange]
  );
  const handleAgentCreate = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, agentName: value.trim() });
    },
    [filters, onFiltersChange]
  );

  const handleBreakdownChange = useCallback(
    (value: SelectableValue<BreakdownDimension>) => {
      onBreakdownChange(value?.value ?? 'none');
    },
    [onBreakdownChange]
  );

  const handleLabelFilterChange = useCallback(
    (index: number, updated: LabelFilter) => {
      const next = [...draftLabelFilters];
      next[index] = updated;
      syncLabelFilters(next);
    },
    [draftLabelFilters, syncLabelFilters]
  );

  const handleLabelFilterRemove = useCallback(
    (index: number) => {
      const next = draftLabelFilters.filter((_, i) => i !== index);
      syncLabelFilters(next);
    },
    [draftLabelFilters, syncLabelFilters]
  );

  const handleAddLabelFilter = useCallback(() => {
    setPendingRows((prev) => [...prev, { key: '', value: '' }]);
  }, []);

  const providerSelectOptions = useMemo(() => providerOptions.map((v) => ({ label: v, value: v })), [providerOptions]);
  const modelSelectOptions = useMemo(() => modelOptions.map((v) => ({ label: v, value: v })), [modelOptions]);
  const agentSelectOptions = useMemo(() => agentOptions.map((v) => ({ label: v, value: v })), [agentOptions]);
  const labelKeySelectOptions = useMemo(() => labelKeyOptions.map((v) => ({ label: v, value: v })), [labelKeyOptions]);

  const handleClearFilters = useCallback(() => {
    setPendingRows([]);
    onFiltersChange({ provider: '', model: '', agentName: '', labelFilters: [] });
  }, [onFiltersChange]);

  return (
    <div className={styles.toolbar}>
      <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
        <TimeRangeInput value={timeRange} onChange={onTimeRangeChange} showIcon />
        <Select<BreakdownDimension>
          options={breakdownOptions}
          value={breakdownBy}
          onChange={handleBreakdownChange}
          prefix="Breakdown by"
          width={28}
        />
        <div className={styles.filterDivider} />
        <Button
          variant={filtersOpen ? 'primary' : 'secondary'}
          icon="filter"
          size="md"
          onClick={() => setFiltersOpen((prev) => !prev)}
        >
          Filters
          {activeFilterCount > 0 && <Badge text={String(activeFilterCount)} color="blue" className={styles.badge} />}
        </Button>
        {filtersOpen && (
          <>
            <Select<string>
              options={providerSelectOptions}
              value={filters.provider || null}
              onChange={handleProviderChange}
              onCreateOption={handleProviderCreate}
              placeholder="Provider"
              isClearable
              allowCustomValue
              isSearchable
              width={20}
            />
            <Select<string>
              options={modelSelectOptions}
              value={filters.model || null}
              onChange={handleModelChange}
              onCreateOption={handleModelCreate}
              placeholder="Model"
              isClearable
              allowCustomValue
              isSearchable
              width={20}
            />
            <Select<string>
              options={agentSelectOptions}
              value={filters.agentName || null}
              onChange={handleAgentChange}
              onCreateOption={handleAgentCreate}
              placeholder="Agent"
              isClearable
              allowCustomValue
              isSearchable
              width={20}
            />
            {draftLabelFilters.map((lf, i) => (
              <LabelFilterRow
                key={i}
                filter={lf}
                index={i}
                labelKeyOptions={labelKeySelectOptions}
                labelsLoading={labelsLoading}
                dataSource={dataSource}
                from={from}
                to={to}
                onChange={handleLabelFilterChange}
                onRemove={handleLabelFilterRemove}
              />
            ))}
            <IconButton
              name="plus-circle"
              aria-label="Add label filter"
              size="md"
              tooltip="Add label filter"
              onClick={handleAddLabelFilter}
            />
            {activeFilterCount > 0 && (
              <Button variant="destructive" fill="text" size="sm" onClick={handleClearFilters}>
                Clear all
              </Button>
            )}
          </>
        )}
      </Stack>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    toolbar: css({
      display: 'flex',
      alignItems: 'center',
      padding: theme.spacing(1, 2),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    badge: css({
      marginLeft: theme.spacing(0.5),
    }),
    filterDivider: css({
      width: 1,
      height: 24,
      backgroundColor: theme.colors.border.medium,
    }),
    operatorBadge: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 28,
      height: 32,
      padding: theme.spacing(0, 0.5),
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.weak}`,
      color: theme.colors.warning.text,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
    }),
  };
}
