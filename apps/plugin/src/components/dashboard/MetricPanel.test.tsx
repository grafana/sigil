import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { dateTime, type PanelData, type TimeRange } from '@grafana/data';
import { MetricPanel } from './MetricPanel';

let capturedPanelData: PanelData | undefined;

// ResizeObserver is not available in JSDOM.
beforeAll(() => {
  global.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb([{ contentRect: { width: 600, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    PanelChrome: ({ children }: { children: React.ReactNode | ((w: number, h: number) => React.ReactNode) }) => (
      <div>{typeof children === 'function' ? children(400, 200) : children}</div>
    ),
  };
});

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  PanelRenderer: ({ data }: { data: PanelData | undefined }) => {
    capturedPanelData = data;
    return <div data-testid="panel-renderer" />;
  },
}));

describe('MetricPanel', () => {
  it('forwards the selected time range to PanelRenderer', async () => {
    const timeRange: TimeRange = {
      from: dateTime('2026-02-16T16:00:00Z'),
      to: dateTime('2026-02-16T17:00:00Z'),
      raw: { from: 'now-1h', to: 'now' },
    };

    render(
      <MetricPanel
        title="Test Panel"
        pluginId="timeseries"
        data={[]}
        loading={false}
        height={200}
        timeRange={timeRange}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('panel-renderer')).toBeInTheDocument();
    });

    if (!capturedPanelData) {
      throw new Error('expected PanelRenderer to receive panel data');
    }
    expect(capturedPanelData.timeRange.from.valueOf()).toBe(timeRange.from.valueOf());
    expect(capturedPanelData.timeRange.to.valueOf()).toBe(timeRange.to.valueOf());
  });
});
