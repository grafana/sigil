import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { AdHocVariableFilter, GrafanaTheme2, MetricFindValue, SelectableValue } from '@grafana/data';
import { initPluginTranslations } from '@grafana/i18n';
import { useStyles2 } from '@grafana/ui';
import { AdHocFiltersVariable, OPERATORS } from '@grafana/scenes';
import type { FilterOperator, LabelFilter } from '../../dashboard/types';
import { plugin } from '../../module';

export type LabelFilterInputProps = {
  filters: LabelFilter[];
  labelKeyOptions: Array<SelectableValue<string>>;
  labelsLoading: boolean;
  loadValues: (filter: LabelFilter) => Promise<Array<SelectableValue<string>>>;
  allowedOperators?: FilterOperator[];
  onDismiss?: () => void;
  onFiltersChange: (filters: LabelFilter[]) => void;
};

type ProviderConfig = {
  allowedOperators: FilterOperator[];
  labelKeyOptions: Array<SelectableValue<string>>;
  loadValues: (filter: LabelFilter) => Promise<Array<SelectableValue<string>>>;
};

class DashboardLabelFiltersVariable extends AdHocFiltersVariable {
  private readonly getConfig: () => ProviderConfig;

  constructor(initialFilters: AdHocVariableFilter[], getConfig: () => ProviderConfig) {
    super({
      name: 'labelFilters',
      datasource: null,
      layout: 'combobox',
      filters: initialFilters,
      allowCustomValue: true,
      inputPlaceholder: 'Filter by label values',
      getTagKeysProvider: async () => ({
        replace: true,
        values: getConfig().labelKeyOptions.map(toMetricFindValue),
      }),
      getTagValuesProvider: async (_variable, filter) => ({
        replace: true,
        values: (await getConfig().loadValues(fromAdHocFilter(filter))).map(toMetricFindValue),
      }),
      expressionBuilder: () => '',
    });
    this.getConfig = getConfig;
  }

  override _getOperators() {
    const allowed = new Set(this.getConfig().allowedOperators);

    return OPERATORS.filter((operator) => allowed.has(operator.value as FilterOperator)).map(
      ({ value, description }) => ({
        label: value,
        value,
        description,
      })
    );
  }
}

export function LabelFilterInput({
  filters,
  labelKeyOptions,
  labelsLoading,
  loadValues,
  allowedOperators = ['=', '!=', '=~', '!~', '<', '<=', '>', '>='],
  onDismiss,
  onFiltersChange,
}: LabelFilterInputProps) {
  const styles = useStyles2(getStyles);
  const [translationsReady, setTranslationsReady] = useState(false);
  const skipNextExternalSyncRef = useRef(false);
  const lastEmittedFiltersRef = useRef<string>(JSON.stringify(filters));
  const lastPropFiltersRef = useRef<string>(JSON.stringify(toAdHocFilters(filters)));
  const configRef = useRef<ProviderConfig>({
    allowedOperators,
    labelKeyOptions,
    loadValues: async () => [],
  });

  configRef.current = {
    allowedOperators,
    labelKeyOptions,
    loadValues,
  };

  const variableRef = useRef<DashboardLabelFiltersVariable | null>(null);
  if (variableRef.current === null) {
    variableRef.current = new DashboardLabelFiltersVariable(toAdHocFilters(filters), () => configRef.current);
  }
  const variable = variableRef.current;
  const variableState = variable.useState();

  useEffect(() => {
    let cancelled = false;

    const ensureTranslations = async () => {
      await initPluginTranslations(plugin.meta.id, []);
      if (!cancelled) {
        setTranslationsReady(true);
      }
    };

    void ensureTranslations();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextFilters = toAdHocFilters(filters);
    const nextSerialized = JSON.stringify(nextFilters);
    const propsChanged = nextSerialized !== lastPropFiltersRef.current;

    lastPropFiltersRef.current = nextSerialized;

    if (!propsChanged) {
      return;
    }

    if (skipNextExternalSyncRef.current) {
      skipNextExternalSyncRef.current = false;
      return;
    }

    if (!sameAdHocFilters(variableState.filters, nextFilters)) {
      variable.updateFilters(nextFilters, { skipPublish: true });
    }
  }, [filters, variable, variableState.filters]);

  useEffect(() => {
    const nextFilters = fromAdHocFilters(variableState.filters);
    const nextSerialized = JSON.stringify(nextFilters);

    if (nextSerialized === lastEmittedFiltersRef.current) {
      return;
    }

    lastEmittedFiltersRef.current = nextSerialized;

    if (!sameLabelFilters(filters, nextFilters)) {
      skipNextExternalSyncRef.current = true;
      onFiltersChange(nextFilters);
    }
  }, [filters, onFiltersChange, variableState.filters]);

  if (!translationsReady) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loadingHint}>Loading filters…</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.combobox}>
        <variable.Component model={variable} />
      </div>
      {onDismiss && (
        <button
          type="button"
          className={styles.dismissToggleHitbox}
          aria-label="Hide label filters"
          onClick={onDismiss}
        />
      )}
      {labelsLoading && <span className={styles.loadingHint}>Loading labels…</span>}
    </div>
  );
}

function toAdHocFilters(filters: LabelFilter[]): AdHocVariableFilter[] {
  return filters.map((filter) => ({
    key: filter.key,
    operator: filter.operator,
    value: filter.value,
    condition: '',
  }));
}

function fromAdHocFilters(filters: AdHocVariableFilter[]): LabelFilter[] {
  return filters
    .filter((filter) => filter.key && filter.operator && filter.value)
    .map((filter) => ({
      key: filter.key,
      operator: filter.operator as FilterOperator,
      value: String(filter.value),
    }));
}

function sameLabelFilters(a: LabelFilter[], b: LabelFilter[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameAdHocFilters(a: AdHocVariableFilter[], b: AdHocVariableFilter[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function toMetricFindValue(option: SelectableValue<string>): MetricFindValue {
  return {
    text: String(option.label ?? option.value ?? ''),
    value: String(option.value ?? option.label ?? ''),
  };
}

function fromAdHocFilter(filter: AdHocVariableFilter): LabelFilter {
  return {
    key: filter.key,
    operator: filter.operator as FilterOperator,
    value: String(filter.value ?? ''),
  };
}

function getStyles(theme: GrafanaTheme2) {
  return {
    wrapper: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      minWidth: 320,
      width: 'fit-content',
      maxWidth: 'min(100%, 960px)',
      flex: '0 1 auto',
      position: 'relative',
    }),
    combobox: css({
      flex: '0 1 auto',
      width: 'fit-content',
      minWidth: 280,
      maxWidth: '100%',
      '& > div, & > div > div': {
        minWidth: 0,
        width: 'fit-content',
        maxWidth: '100%',
      },
    }),
    dismissToggleHitbox: css({
      position: 'absolute',
      left: theme.spacing(0.5),
      top: theme.spacing(0.5),
      width: theme.spacing(4),
      height: theme.spacing(4),
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      borderRadius: theme.shape.radius.default,
      zIndex: 1,
    }),
    loadingHint: css({
      color: theme.colors.text.secondary,
      ...theme.typography.bodySmall,
    }),
  };
}
