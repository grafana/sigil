import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import {
  PanelChrome,
  PanelContextProvider,
  SeriesVisibilityChangeMode,
  useStyles2,
  type PanelContext,
} from '@grafana/ui';
import { PanelRenderer } from '@grafana/runtime';
import {
  EventBusSrv,
  LoadingState,
  type AbsoluteTimeRange,
  type DataFrame,
  type FieldConfigSource,
  type GrafanaTheme2,
  type PanelData,
  type TimeRange,
} from '@grafana/data';

export type MetricPanelProps = {
  title: string;
  description?: string;
  pluginId: string;
  data: DataFrame[];
  loading: boolean;
  error?: string;
  height: number;
  timeRange: TimeRange;
  onChangeTimeRange?: (timeRange: AbsoluteTimeRange) => void;
  options?: Record<string, unknown>;
  fieldConfig?: FieldConfigSource;
  actions?: React.ReactNode;
  titleItems?: React.ReactNode;
};

function seriesVisibilityConfigFactory(
  label: string,
  mode: SeriesVisibilityChangeMode,
  fieldConfig: FieldConfigSource,
  data: DataFrame[]
): FieldConfigSource {
  const allFieldNames = new Set<string>();
  for (const frame of data) {
    for (let i = 1; i < frame.fields.length; i++) {
      const field = frame.fields[i];
      const name = field.config?.displayName ?? field.name;
      allFieldNames.add(name);
    }
  }

  const existingOverrides = fieldConfig.overrides ?? [];

  const hiddenNames = new Set<string>();
  for (const ov of existingOverrides) {
    if (ov.matcher?.id === 'byName') {
      const isHidden = ov.properties?.some(
        (p: { id: string; value?: { viz?: boolean } }) => p.id === 'custom.hideFrom' && p.value?.viz === true
      );
      if (isHidden) {
        hiddenNames.add(ov.matcher.options as string);
      }
    }
  }

  if (mode === SeriesVisibilityChangeMode.ToggleSelection) {
    const onlyThisVisible = hiddenNames.size === allFieldNames.size - 1 && !hiddenNames.has(label);
    if (onlyThisVisible) {
      return {
        ...fieldConfig,
        overrides: existingOverrides.filter(
          (ov) =>
            !(
              ov.matcher?.id === 'byName' &&
              ov.properties?.some(
                (p: { id: string; value?: { viz?: boolean } }) => p.id === 'custom.hideFrom' && p.value?.viz === true
              )
            )
        ),
      };
    }

    const nonVisibilityOverrides = existingOverrides.filter(
      (ov) =>
        !(
          ov.matcher?.id === 'byName' &&
          ov.properties?.some(
            (p: { id: string; value?: { viz?: boolean } }) => p.id === 'custom.hideFrom' && p.value?.viz === true
          )
        )
    );
    const hideOverrides = [...allFieldNames]
      .filter((name) => name !== label)
      .map((name) => ({
        matcher: { id: 'byName', options: name },
        properties: [{ id: 'custom.hideFrom', value: { viz: true, legend: false, tooltip: false } }],
      }));

    return { ...fieldConfig, overrides: [...nonVisibilityOverrides, ...hideOverrides] };
  }

  if (hiddenNames.has(label)) {
    return {
      ...fieldConfig,
      overrides: existingOverrides.filter(
        (ov) =>
          !(
            ov.matcher?.id === 'byName' &&
            ov.matcher.options === label &&
            ov.properties?.some(
              (p: { id: string; value?: { viz?: boolean } }) => p.id === 'custom.hideFrom' && p.value?.viz === true
            )
          )
      ),
    };
  }

  return {
    ...fieldConfig,
    overrides: [
      ...existingOverrides,
      {
        matcher: { id: 'byName', options: label },
        properties: [{ id: 'custom.hideFrom', value: { viz: true, legend: false, tooltip: false } }],
      },
    ],
  };
}

export function MetricPanel({
  title,
  description,
  pluginId,
  data,
  loading,
  error,
  height,
  timeRange,
  onChangeTimeRange,
  options = {},
  fieldConfig = { defaults: {}, overrides: [] },
  actions,
  titleItems,
}: MetricPanelProps) {
  const styles = useStyles2(getStyles);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableOptions = useMemo(() => options, [JSON.stringify(options)]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFieldConfig = useMemo(() => fieldConfig, [JSON.stringify(fieldConfig)]);

  const [userFieldConfig, setUserFieldConfig] = useState<FieldConfigSource | null>(null);
  const [userOptions, setUserOptions] = useState<Record<string, unknown> | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    setUserFieldConfig(null);
    setUserOptions(null);
    setResetKey((k) => k + 1);
  }, [stableFieldConfig, stableOptions]);

  const liveFieldConfig = userFieldConfig ?? stableFieldConfig;
  const liveOptions = userOptions ?? stableOptions;

  const onOptionsChange = useCallback((updated: Record<string, unknown>) => {
    setUserOptions(updated);
  }, []);

  const onFieldConfigChange = useCallback((updated: FieldConfigSource) => {
    setUserFieldConfig(updated);
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const panelData = useMemo<PanelData>(
    () => ({
      series: data,
      state: loading ? LoadingState.Loading : error ? LoadingState.Error : LoadingState.Done,
      timeRange,
    }),
    [data, loading, error, timeRange]
  );

  const eventBus = useMemo(() => new EventBusSrv(), []);

  const panelContext = useMemo<PanelContext>(
    () => ({
      eventsScope: 'panel',
      eventBus,
      onToggleSeriesVisibility: (label: string, mode: SeriesVisibilityChangeMode) => {
        setUserFieldConfig((prev) => {
          const current = prev ?? stableFieldConfig;
          return seriesVisibilityConfigFactory(label, mode, current, data);
        });
      },
    }),
    [eventBus, stableFieldConfig, data]
  );

  return (
    <div ref={containerRef} className={styles.container} style={{ height }}>
      {width > 0 && (
        <PanelChrome
          title={title}
          description={description}
          width={width}
          height={height}
          loadingState={loading ? LoadingState.Loading : undefined}
          statusMessage={error}
          actions={actions}
          titleItems={titleItems}
        >
          {(innerWidth, innerHeight) => (
            <PanelContextProvider value={panelContext}>
              <PanelRenderer
                key={resetKey}
                pluginId={pluginId}
                title=""
                data={panelData}
                options={liveOptions}
                fieldConfig={liveFieldConfig}
                width={innerWidth}
                height={innerHeight}
                timeZone="browser"
                onOptionsChange={onOptionsChange}
                onFieldConfigChange={onFieldConfigChange}
                onChangeTimeRange={onChangeTimeRange}
              />
            </PanelContextProvider>
          )}
        </PanelChrome>
      )}
    </div>
  );
}

function getStyles(_theme: GrafanaTheme2) {
  return {
    container: css({
      width: '100%',
    }),
  };
}
