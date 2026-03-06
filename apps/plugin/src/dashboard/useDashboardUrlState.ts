import { useCallback, useMemo } from 'react';
import { type TimeRange } from '@grafana/data';
import { type BreakdownDimension, type DashboardFilters, type DashboardTab } from './types';
import { useFilterUrlState } from '../hooks/useFilterUrlState';

const BREAKDOWN_VALUES = new Set<BreakdownDimension>(['none', 'provider', 'model', 'agent']);
const TAB_VALUES = new Set<DashboardTab>(['overview', 'performance', 'errors', 'usage', 'evaluation']);

const TAB_MIGRATION: Record<string, DashboardTab> = {
  consumption: 'usage',
  cache: 'usage',
};

function setOrDelete(params: URLSearchParams, key: string, value: string, defaultValue = ''): void {
  if (value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
}

function parseBreakdown(params: URLSearchParams): BreakdownDimension {
  const v = params.get('breakdownBy') as BreakdownDimension;
  return BREAKDOWN_VALUES.has(v) ? v : 'agent';
}

function parseTab(params: URLSearchParams): DashboardTab {
  const raw = params.get('tab') ?? '';
  if (TAB_VALUES.has(raw as DashboardTab)) {
    return raw as DashboardTab;
  }
  if (raw in TAB_MIGRATION) {
    return TAB_MIGRATION[raw];
  }
  return 'overview';
}

export type DashboardUrlState = {
  timeRange: TimeRange;
  filters: DashboardFilters;
  breakdownBy: BreakdownDimension;
  tab: DashboardTab;
  setTimeRange: (tr: TimeRange) => void;
  setFilters: (f: DashboardFilters) => void;
  setBreakdownBy: (b: BreakdownDimension) => void;
  setTab: (t: DashboardTab) => void;
};

export function useDashboardUrlState(): DashboardUrlState {
  const { timeRange, filters, searchParams, setTimeRange, setFilters, setSearchParams } = useFilterUrlState();

  const breakdownBy = useMemo(() => parseBreakdown(searchParams), [searchParams]);
  const tab = useMemo(() => parseTab(searchParams), [searchParams]);

  const setBreakdownBy = useCallback(
    (b: BreakdownDimension) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'breakdownBy', b, 'agent');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setTab = useCallback(
    (t: DashboardTab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'tab', t, 'overview');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return {
    timeRange,
    filters,
    breakdownBy,
    tab,
    setTimeRange,
    setFilters,
    setBreakdownBy,
    setTab,
  };
}
