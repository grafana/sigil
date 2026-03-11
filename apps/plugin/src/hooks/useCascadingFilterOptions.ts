import { useMemo } from 'react';
import type { DashboardDataSource } from '../dashboard/api';
import { buildCascadingSelector, buildScopedLabelMatcher } from '../dashboard/queries';
import type { DashboardFilters } from '../dashboard/types';
import { useLabelNames } from '../components/dashboard/useLabelNames';
import { useLabelValues } from '../components/dashboard/useLabelValues';

const NOISE_LABELS = new Set(['__name__', 'le', 'quantile']);
const DEDICATED_FILTER_LABELS = new Set(['gen_ai_provider_name', 'gen_ai_request_model', 'gen_ai_agent_name']);

function labelPriority(label: string): number {
  if (label.startsWith('gen_ai_')) {
    return 0;
  }
  if (label.startsWith('telemetry_') || label.includes('service') || label === 'job' || label === 'instance') {
    return 1;
  }
  return 2;
}

export type CascadingFilterOptions = {
  providerOptions: string[];
  modelOptions: string[];
  agentOptions: string[];
  labelKeyOptions: string[];
  labelsLoading: boolean;
};

export function useCascadingFilterOptions(
  dataSource: DashboardDataSource,
  filters: DashboardFilters,
  from: number,
  to: number
): CascadingFilterOptions {
  const providerMatcher = useMemo(
    () => buildCascadingSelector({ gen_ai_provider_name: filters.providers }),
    [filters.providers]
  );

  const providerAndModelMatcher = useMemo(
    () =>
      buildCascadingSelector({
        gen_ai_provider_name: filters.providers,
        gen_ai_request_model: filters.models,
      }),
    [filters.providers, filters.models]
  );

  const providerValues = useLabelValues(dataSource, 'gen_ai_provider_name', from, to);
  const modelValues = useLabelValues(dataSource, 'gen_ai_request_model', from, to, providerMatcher);
  const agentValues = useLabelValues(dataSource, 'gen_ai_agent_name', from, to, providerAndModelMatcher);

  const labelMatcher = useMemo(() => buildScopedLabelMatcher(filters), [filters]);
  const labelNames = useLabelNames(dataSource, from, to, labelMatcher);

  const labelKeyOptions = useMemo(() => {
    return Array.from(new Set(labelNames.names))
      .filter((label) => !NOISE_LABELS.has(label) && !DEDICATED_FILTER_LABELS.has(label))
      .sort((a, b) => {
        const byPriority = labelPriority(a) - labelPriority(b);
        if (byPriority !== 0) {
          return byPriority;
        }
        return a.localeCompare(b);
      });
  }, [labelNames.names]);

  return {
    providerOptions: providerValues.values,
    modelOptions: modelValues.values,
    agentOptions: agentValues.values,
    labelKeyOptions,
    labelsLoading: labelNames.loading,
  };
}
