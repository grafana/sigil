// Ported from Grafana's TraceView (Apache 2.0)

import type { ViewedBoundsFunctionType } from './types';

export function createViewedBoundsFunc(viewRange: {
  min: number;
  max: number;
  viewStart: number;
  viewEnd: number;
}): ViewedBoundsFunctionType {
  const { min, max, viewStart, viewEnd } = viewRange;
  const duration = max - min;
  const viewMin = min + viewStart * duration;
  const viewMax = max - (1 - viewEnd) * duration;
  const viewWindow = viewMax - viewMin;

  return (start: number, end: number) => ({
    start: (start - viewMin) / viewWindow,
    end: (end - viewMin) / viewWindow,
  });
}
