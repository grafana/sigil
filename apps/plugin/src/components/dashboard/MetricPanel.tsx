import React, { useRef, useState, useEffect } from 'react';
import { PanelChrome } from '@grafana/ui';
import { PanelRenderer } from '@grafana/runtime';
import { LoadingState, type DataFrame, type FieldConfigSource, type PanelData, type TimeRange } from '@grafana/data';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

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
    <div ref={containerRef} style={{ width: '100%', height }}>
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
              options={options}
              fieldConfig={fieldConfig}
              width={innerWidth}
              height={innerHeight}
            />
          )}
        </PanelChrome>
      )}
    </div>
  );
}
