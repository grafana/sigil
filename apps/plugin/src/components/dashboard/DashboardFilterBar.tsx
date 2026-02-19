import React, { useCallback, useMemo } from 'react';
import { TimeRangePicker, Select, Stack, Input } from '@grafana/ui';
import { dateTimeParse, type SelectableValue, type TimeRange } from '@grafana/data';
import type { DashboardFilters } from '../../dashboard/types';

export type DashboardFilterBarProps = {
  timeRange: TimeRange;
  filters: DashboardFilters;
  providerOptions: string[];
  modelOptions: string[];
  agentOptions: string[];
  labelKeyOptions: string[];
  labelValueOptions: string[];
  labelsLoading?: boolean;
  labelValuesLoading?: boolean;
  onTimeRangeChange: (timeRange: TimeRange) => void;
  onFiltersChange: (filters: DashboardFilters) => void;
};

export function DashboardFilterBar({
  timeRange,
  filters,
  providerOptions,
  modelOptions,
  agentOptions,
  labelKeyOptions,
  labelValueOptions,
  labelsLoading = false,
  labelValuesLoading = false,
  onTimeRangeChange,
  onFiltersChange,
}: DashboardFilterBarProps) {
  const handleProviderChange = useCallback(
    (value: SelectableValue<string>) => {
      onFiltersChange({ ...filters, provider: value?.value ?? '' });
    },
    [filters, onFiltersChange]
  );
  const handleProviderCreate = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, provider: value.trim() });
    },
    [filters, onFiltersChange]
  );

  const handleModelChange = useCallback(
    (value: SelectableValue<string>) => {
      onFiltersChange({ ...filters, model: value?.value ?? '' });
    },
    [filters, onFiltersChange]
  );
  const handleModelCreate = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, model: value.trim() });
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

  const providerSelectOptions = useMemo(() => providerOptions.map((v) => ({ label: v, value: v })), [providerOptions]);
  const modelSelectOptions = useMemo(() => modelOptions.map((v) => ({ label: v, value: v })), [modelOptions]);
  const agentSelectOptions = useMemo(() => agentOptions.map((v) => ({ label: v, value: v })), [agentOptions]);
  const labelKeySelectOptions = useMemo(() => labelKeyOptions.map((v) => ({ label: v, value: v })), [labelKeyOptions]);
  const labelValueSelectOptions = useMemo(
    () => labelValueOptions.map((v) => ({ label: v, value: v })),
    [labelValueOptions]
  );

  const handleLabelKeyChange = useCallback(
    (value: SelectableValue<string>) => {
      onFiltersChange({ ...filters, labelKey: value?.value ?? '', labelValue: '' });
    },
    [filters, onFiltersChange]
  );

  const handleLabelKeyCreate = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, labelKey: value.trim(), labelValue: '' });
    },
    [filters, onFiltersChange]
  );

  const handleLabelValueChange = useCallback(
    (value: SelectableValue<string>) => {
      onFiltersChange({ ...filters, labelValue: value?.value ?? '' });
    },
    [filters, onFiltersChange]
  );

  const handleLabelValueCreate = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, labelValue: value.trim() });
    },
    [filters, onFiltersChange]
  );

  const handleExtraMatchersChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, extraMatchers: event.currentTarget.value });
    },
    [filters, onFiltersChange]
  );

  const onMoveBackward = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    onTimeRangeChange({
      from: dateTimeParse(timeRange.from.valueOf() - diff),
      to: dateTimeParse(timeRange.to.valueOf() - diff),
      raw: {
        from: dateTimeParse(timeRange.from.valueOf() - diff),
        to: dateTimeParse(timeRange.to.valueOf() - diff),
      },
    });
  }, [timeRange, onTimeRangeChange]);

  const onMoveForward = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    onTimeRangeChange({
      from: dateTimeParse(timeRange.from.valueOf() + diff),
      to: dateTimeParse(timeRange.to.valueOf() + diff),
      raw: {
        from: dateTimeParse(timeRange.from.valueOf() + diff),
        to: dateTimeParse(timeRange.to.valueOf() + diff),
      },
    });
  }, [timeRange, onTimeRangeChange]);

  const onZoom = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    const center = timeRange.from.valueOf() + diff / 2;
    onTimeRangeChange({
      from: dateTimeParse(center - diff),
      to: dateTimeParse(center + diff),
      raw: {
        from: dateTimeParse(center - diff),
        to: dateTimeParse(center + diff),
      },
    });
  }, [timeRange, onTimeRangeChange]);

  return (
    <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
      <TimeRangePicker
        value={timeRange}
        onChange={onTimeRangeChange}
        onChangeTimeZone={() => {}}
        onMoveBackward={onMoveBackward}
        onMoveForward={onMoveForward}
        onZoom={onZoom}
      />
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
        width={24}
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
      <Select<string>
        options={labelKeySelectOptions}
        value={filters.labelKey || null}
        onChange={handleLabelKeyChange}
        onCreateOption={handleLabelKeyCreate}
        placeholder="Any Label Key (gen_ai)"
        isClearable
        isLoading={labelsLoading}
        allowCustomValue
        isSearchable
        width={24}
      />
      <Select<string>
        options={labelValueSelectOptions}
        value={filters.labelValue || null}
        onChange={handleLabelValueChange}
        onCreateOption={handleLabelValueCreate}
        placeholder={filters.labelKey ? `${filters.labelKey} value` : 'Label Value'}
        isClearable
        disabled={!filters.labelKey}
        isLoading={labelValuesLoading}
        allowCustomValue
        isSearchable
        width={24}
      />
      <Input
        value={filters.extraMatchers}
        onChange={handleExtraMatchersChange}
        placeholder={'Extra matchers (e.g. service_name=~"api",job="sigil")'}
        width={40}
      />
    </Stack>
  );
}
