import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { PanelChrome, useStyles2 } from '@grafana/ui';
import { PanelRenderer } from '@grafana/runtime';
import {
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
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    setUserFieldConfig(null);
    setResetKey((k) => k + 1);
  }, [stableFieldConfig]);

  const liveFieldConfig = userFieldConfig ?? stableFieldConfig;

  const onOptionsChange = useCallback(() => {}, []);

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
            <PanelRenderer
              key={resetKey}
              pluginId={pluginId}
              title=""
              data={panelData}
              options={stableOptions}
              fieldConfig={liveFieldConfig}
              width={innerWidth}
              height={innerHeight}
              timeZone="browser"
              onOptionsChange={onOptionsChange}
              onFieldConfigChange={onFieldConfigChange}
              onChangeTimeRange={onChangeTimeRange}
            />
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
