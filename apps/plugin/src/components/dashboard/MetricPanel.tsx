import React, { useCallback, useRef, useState, useEffect } from 'react';
import { css } from '@emotion/css';
import { PanelChrome, useStyles2 } from '@grafana/ui';
import { PanelRenderer } from '@grafana/runtime';
import { LoadingState, type DataFrame, type FieldConfigSource, type GrafanaTheme2, type PanelData, type TimeRange } from '@grafana/data';

export type MetricPanelProps = {
  title: string;
  description?: string;
  pluginId: string;
  data: DataFrame[];
  loading: boolean;
  error?: string;
  height: number;
  timeRange: TimeRange;
  options?: Record<string, unknown>;
  fieldConfig?: FieldConfigSource;
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
  options = {},
  fieldConfig = { defaults: {}, overrides: [] },
}: MetricPanelProps) {
  const styles = useStyles2(getStyles);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [liveOptions, setLiveOptions] = useState(options);
  const [liveFieldConfig, setLiveFieldConfig] = useState(fieldConfig);

  useEffect(() => {
    setLiveOptions(options);
  }, [options]);

  useEffect(() => {
    setLiveFieldConfig(fieldConfig);
  }, [fieldConfig]);

  const onOptionsChange = useCallback((updated: Record<string, unknown>) => {
    setLiveOptions(updated);
  }, []);

  const onFieldConfigChange = useCallback((updated: FieldConfigSource) => {
    setLiveFieldConfig(updated);
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

  const panelData: PanelData = {
    series: data,
    state: loading ? LoadingState.Loading : error ? LoadingState.Error : LoadingState.Done,
    timeRange,
  };

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
        >
          {(innerWidth, innerHeight) => (
            <PanelRenderer
              pluginId={pluginId}
              title=""
              data={panelData}
              options={liveOptions}
              fieldConfig={liveFieldConfig}
              width={innerWidth}
              height={innerHeight}
              onOptionsChange={onOptionsChange}
              onFieldConfigChange={onFieldConfigChange}
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
      '& > div': {
        border: 'none',
      },
    }),
  };
}
