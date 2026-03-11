import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, type GrafanaTheme2, type SelectableValue, type TimeRange } from '@grafana/data';
import { IconButton, MultiSelect, Stack, TimeRangePicker, useStyles2 } from '@grafana/ui';
import { buildScopedLabelMatcher } from '../../dashboard/queries';
import { type DashboardFilters, FILTER_OPERATORS, type FilterOperator, type LabelFilter } from '../../dashboard/types';
import type { DashboardDataSource } from '../../dashboard/api';
import { LabelFilterInput } from './LabelFilterInput';

export type FilterToolbarProps = {
  timeRange: TimeRange;
  filters: DashboardFilters;
  providerOptions: string[];
  modelOptions: string[];
  agentOptions: string[];
  labelKeyOptions: string[];
  labelsLoading?: boolean;
  dataSource?: DashboardDataSource;
  from: number;
  to: number;
  onTimeRangeChange: (timeRange: TimeRange) => void;
  onFiltersChange: (filters: DashboardFilters) => void;
  hideLabelFilters?: boolean;
  fillWidth?: boolean;
  labelFilterOperators?: FilterOperator[];
  loadLabelValues?: (filter: LabelFilter) => Promise<Array<SelectableValue<string>>>;
  defaultShowLabelFilterRow?: boolean;
  showLabelFilterRow?: boolean;
  onLabelFilterRowOpenChange?: (isOpen: boolean) => void;
  children?: React.ReactNode;
};

export function FilterToolbar({
  timeRange,
  filters,
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
  hideLabelFilters = false,
  fillWidth = false,
  labelFilterOperators = FILTER_OPERATORS,
  loadLabelValues,
  defaultShowLabelFilterRow = false,
  showLabelFilterRow,
  onLabelFilterRowOpenChange,
  children,
}: FilterToolbarProps) {
  const styles = useStyles2(getStyles);

  const [internalShowLabelFilterRow, setInternalShowLabelFilterRow] = useState(defaultShowLabelFilterRow);
  const labelFilterRowOpen = showLabelFilterRow ?? internalShowLabelFilterRow;

  const setLabelFilterRowOpen = useCallback(
    (next: boolean) => {
      if (showLabelFilterRow === undefined) {
        setInternalShowLabelFilterRow(next);
      }
      onLabelFilterRowOpenChange?.(next);
    },
    [onLabelFilterRowOpenChange, showLabelFilterRow]
  );

  const activeFilterCount = useMemo(() => {
    return (
      filters.providers.length +
      filters.models.length +
      filters.agentNames.length +
      filters.labelFilters.filter((lf) => lf.key && lf.value).length
    );
  }, [filters]);
  const completedLabelFilterCount = filters.labelFilters.filter((lf) => lf.key && lf.value).length;
  const hiddenLabelFilterCount = hideLabelFilters || !labelFilterRowOpen ? completedLabelFilterCount : 0;

  const handleProviderChange = useCallback(
    (values: Array<SelectableValue<string>>) => {
      onFiltersChange({ ...filters, providers: values.map((v) => v.value!).filter(Boolean) });
    },
    [filters, onFiltersChange]
  );
  const handleProviderCreate = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, providers: [...filters.providers, value.trim()] });
    },
    [filters, onFiltersChange]
  );

  const handleModelChange = useCallback(
    (values: Array<SelectableValue<string>>) => {
      onFiltersChange({ ...filters, models: values.map((v) => v.value!).filter(Boolean) });
    },
    [filters, onFiltersChange]
  );
  const handleModelCreate = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, models: [...filters.models, value.trim()] });
    },
    [filters, onFiltersChange]
  );

  const handleAgentChange = useCallback(
    (values: Array<SelectableValue<string>>) => {
      onFiltersChange({ ...filters, agentNames: values.map((v) => v.value!).filter(Boolean) });
    },
    [filters, onFiltersChange]
  );
  const handleAgentCreate = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, agentNames: [...filters.agentNames, value.trim()] });
    },
    [filters, onFiltersChange]
  );

  const handleLabelFiltersChange = useCallback(
    (nextLabelFilters: LabelFilter[]) => {
      onFiltersChange({ ...filters, labelFilters: nextLabelFilters });
    },
    [filters, onFiltersChange]
  );

  const handleClearFilters = useCallback(() => {
    setLabelFilterRowOpen(false);
    onFiltersChange({ providers: [], models: [], agentNames: [], labelFilters: [] });
  }, [onFiltersChange, setLabelFilterRowOpen]);

  const handleShowLabelFilters = useCallback(() => {
    setLabelFilterRowOpen(true);
  }, [setLabelFilterRowOpen]);

  const handleHideLabelFilters = useCallback(() => {
    setLabelFilterRowOpen(false);
  }, [setLabelFilterRowOpen]);

  const providerSelectOptions = useMemo(() => providerOptions.map((v) => ({ label: v, value: v })), [providerOptions]);
  const modelSelectOptions = useMemo(() => modelOptions.map((v) => ({ label: v, value: v })), [modelOptions]);
  const agentSelectOptions = useMemo(() => agentOptions.map((v) => ({ label: v, value: v })), [agentOptions]);
  const labelKeySelectOptions = useMemo(() => labelKeyOptions.map((v) => ({ label: v, value: v })), [labelKeyOptions]);
  const getValueMatchers = useCallback(
    (index: number, filter: LabelFilter) => {
      const resolvedIndex =
        index < filters.labelFilters.length
          ? index
          : filters.labelFilters.findIndex(
              (candidate) =>
                candidate.key === filter.key &&
                candidate.operator === filter.operator &&
                candidate.value === filter.value
            );

      return buildScopedLabelMatcher(filters, filters.labelFilters, resolvedIndex >= 0 ? [resolvedIndex] : undefined);
    },
    [filters]
  );
  const defaultLoadLabelValues = useCallback(
    async (filter: LabelFilter) => {
      if (!dataSource) {
        return [];
      }
      const matcher = getValueMatchers?.(findFilterIndex(filters.labelFilters, filter), filter);
      const values = await dataSource.labelValues(filter.key, from, to, matcher);
      return values.map((value) => ({ label: value, value }));
    },
    [dataSource, filters.labelFilters, from, getValueMatchers, to]
  );

  return (
    <div className={styles.toolbar}>
      {children && (
        <>
          {children}
          <div className={styles.divider} />
        </>
      )}
      <div className={fillWidth ? styles.filtersSectionFill : styles.filtersSection}>
        <div className={styles.filtersColumn}>
          <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
            <MultiSelect<string>
              className={fillWidth ? styles.multiSelectFill : styles.multiSelect}
              options={providerSelectOptions}
              value={filters.providers}
              onChange={handleProviderChange}
              onCreateOption={handleProviderCreate}
              placeholder="Provider"
              isClearable
              allowCustomValue
              isSearchable
              width={fillWidth ? undefined : 'auto'}
            />
            <MultiSelect<string>
              className={fillWidth ? styles.multiSelectFill : styles.multiSelect}
              options={modelSelectOptions}
              value={filters.models}
              onChange={handleModelChange}
              onCreateOption={handleModelCreate}
              placeholder="Model"
              isClearable
              allowCustomValue
              isSearchable
              width={fillWidth ? undefined : 'auto'}
            />
            <MultiSelect<string>
              className={fillWidth ? styles.multiSelectFill : styles.multiSelect}
              options={agentSelectOptions}
              value={filters.agentNames}
              onChange={handleAgentChange}
              onCreateOption={handleAgentCreate}
              placeholder="Agent"
              isClearable
              allowCustomValue
              isSearchable
              width={fillWidth ? undefined : 'auto'}
            />
            {!hideLabelFilters && !labelFilterRowOpen && (
              <IconButton
                name="filter"
                aria-label="Show label filters"
                tooltip="Show label filters"
                size="md"
                onClick={handleShowLabelFilters}
                className={styles.filterToggleButton}
              />
            )}
            {hiddenLabelFilterCount > 0 && (
              <span className={styles.hiddenLabelSummary}>
                {hiddenLabelFilterCount} label filter{hiddenLabelFilterCount === 1 ? '' : 's'} active
              </span>
            )}
            {activeFilterCount > 0 && (
              <IconButton
                name="times-circle"
                aria-label="Clear all filters"
                tooltip="Clear all filters"
                size="md"
                onClick={handleClearFilters}
                className={styles.clearButton}
              />
            )}
          </Stack>
          {!hideLabelFilters && labelFilterRowOpen && (
            <div className={styles.labelFilterRow} data-testid="label-filter-row">
              <LabelFilterInput
                filters={filters.labelFilters}
                labelKeyOptions={labelKeySelectOptions}
                labelsLoading={labelsLoading}
                loadValues={loadLabelValues ?? defaultLoadLabelValues}
                allowedOperators={labelFilterOperators}
                onDismiss={handleHideLabelFilters}
                onFiltersChange={handleLabelFiltersChange}
              />
            </div>
          )}
        </div>
      </div>
      <TimeRangePicker
        value={timeRange}
        onChange={onTimeRangeChange}
        onChangeTimeZone={() => {}}
        onMoveBackward={() => {
          const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
          const from = dateTime(timeRange.from.valueOf() - diff);
          const to = dateTime(timeRange.to.valueOf() - diff);
          onTimeRangeChange({ from, to, raw: { from: from.toISOString(), to: to.toISOString() } });
        }}
        onMoveForward={() => {
          const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
          const from = dateTime(timeRange.from.valueOf() + diff);
          const to = dateTime(timeRange.to.valueOf() + diff);
          onTimeRangeChange({ from, to, raw: { from: from.toISOString(), to: to.toISOString() } });
        }}
        onZoom={() => {
          const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
          const from = dateTime(timeRange.from.valueOf() - diff / 2);
          const to = dateTime(timeRange.to.valueOf() + diff / 2);
          onTimeRangeChange({ from, to, raw: { from: from.toISOString(), to: to.toISOString() } });
        }}
        isOnCanvas
      />
    </div>
  );
}

function findFilterIndex(filters: LabelFilter[], filter: LabelFilter): number {
  const index = filters.findIndex(
    (candidate) =>
      candidate.key === filter.key && candidate.operator === filter.operator && candidate.value === filter.value
  );

  return index >= 0 ? index : filters.length;
}

function getStyles(theme: GrafanaTheme2) {
  return {
    toolbar: css({
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      padding: theme.spacing(1, 2),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    filtersSection: css({
      display: 'flex',
      flex: '1 1 auto',
      minWidth: 0,
    }),
    filtersSectionFill: css({
      display: 'flex',
      flex: '1 1 auto',
      minWidth: 0,
      '& > div': {
        flex: 1,
      },
    }),
    filtersColumn: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
      flex: 1,
      minWidth: 0,
    }),
    divider: css({
      width: 1,
      alignSelf: 'stretch',
      background: theme.colors.border.medium,
    }),
    multiSelect: css({
      minWidth: 150,
      ...theme.typography.body,
    }),
    multiSelectFill: css({
      flex: '1 1 0%',
      minWidth: 120,
      ...theme.typography.body,
    }),
    clearButton: css({
      color: theme.colors.text.secondary,
      '&:hover': {
        color: theme.colors.error.text,
      },
    }),
    filterToggleButton: css({
      color: theme.colors.text.secondary,
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
    hiddenLabelSummary: css({
      color: theme.colors.text.secondary,
      background: theme.colors.action.disabledBackground,
      borderRadius: theme.shape.radius.default,
      minHeight: 24,
      padding: theme.spacing(0.25, 1),
      ...theme.typography.bodySmall,
    }),
    labelFilterRow: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      width: 'fit-content',
      maxWidth: '100%',
      minWidth: 0,
      '& > :first-child': {
        flex: '0 1 auto',
        minWidth: 0,
        maxWidth: '100%',
      },
    }),
  };
}
