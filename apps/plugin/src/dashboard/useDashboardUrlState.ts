import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dateTimeParse, type TimeRange } from '@grafana/data';
import { type BreakdownDimension, type DashboardFilters, type DashboardTab, type LabelFilter } from './types';

const BREAKDOWN_VALUES = new Set<BreakdownDimension>(['none', 'provider', 'model', 'agent']);
const TAB_VALUES = new Set<DashboardTab>(['overview', 'errors', 'consumption', 'cache']);

const DEFAULT_FROM = 'now-1h';
const DEFAULT_TO = 'now';

function parseTimeRange(params: URLSearchParams): TimeRange {
  const rawFrom = params.get('from') || DEFAULT_FROM;
  const rawTo = params.get('to') || DEFAULT_TO;
  return {
    from: dateTimeParse(rawFrom),
    to: dateTimeParse(rawTo),
    raw: { from: rawFrom, to: rawTo },
  };
}

function parseLabelFilters(params: URLSearchParams): LabelFilter[] {
  const raw = params.getAll('label');
  const filters: LabelFilter[] = [];
  for (const entry of raw) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx > 0) {
      filters.push({ key: entry.slice(0, colonIdx), value: entry.slice(colonIdx + 1) });
    }
  }
  return filters;
}

function parseFilters(params: URLSearchParams): DashboardFilters {
  return {
    provider: params.get('provider') || '',
    model: params.get('model') || '',
    agentName: params.get('agent') || '',
    labelFilters: parseLabelFilters(params),
  };
}

function parseBreakdown(params: URLSearchParams): BreakdownDimension {
  const v = params.get('breakdownBy') as BreakdownDimension;
  return BREAKDOWN_VALUES.has(v) ? v : 'provider';
}

function parseTab(params: URLSearchParams): DashboardTab {
  const v = params.get('tab') as DashboardTab;
  return TAB_VALUES.has(v) ? v : 'overview';
}

function setOrDelete(params: URLSearchParams, key: string, value: string, defaultValue = ''): void {
  if (value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
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
  const [searchParams, setSearchParams] = useSearchParams();

  const timeRange = useMemo(() => parseTimeRange(searchParams), [searchParams]);
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const breakdownBy = useMemo(() => parseBreakdown(searchParams), [searchParams]);
  const tab = useMemo(() => parseTab(searchParams), [searchParams]);

  const setTimeRange = useCallback(
    (tr: TimeRange) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'from', String(tr.raw.from), DEFAULT_FROM);
          setOrDelete(next, 'to', String(tr.raw.to), DEFAULT_TO);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setFilters = useCallback(
    (f: DashboardFilters) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'provider', f.provider);
          setOrDelete(next, 'model', f.model);
          setOrDelete(next, 'agent', f.agentName);
          next.delete('label');
          for (const lf of f.labelFilters) {
            if (lf.key && lf.value) {
              next.append('label', `${lf.key}:${lf.value}`);
            }
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setBreakdownBy = useCallback(
    (b: BreakdownDimension) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'breakdownBy', b, 'provider');
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
