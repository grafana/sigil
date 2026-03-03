const TRACE_ROW_GRADIENT_OKLAB_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [0.87, -0.01, 0.21],
  [0.73, 0.13, 0.17],
  [0.65, 0.2, 0.14],
  [0.64, 0.28, 0.01],
  [0.65, 0.27, -0.16],
  [0.49, 0.04, -0.3],
  [0.54, 0.12, -0.28],
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function formatOKLabChannel(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, '');
}

export function getGradientColorAtIndex(total: number, index: number, alpha = 1): string {
  const clampedAlpha = clamp(alpha, 0, 1);
  if (!Number.isFinite(total) || total <= 1) {
    const [l, a, b] = TRACE_ROW_GRADIENT_OKLAB_STOPS[0];
    return `oklab(${formatOKLabChannel(l)} ${formatOKLabChannel(a)} ${formatOKLabChannel(b)} / ${formatOKLabChannel(clampedAlpha)})`;
  }

  const clampedIndex = clamp(Math.round(index), 0, total - 1);
  const t = clampedIndex / (total - 1);
  const segmentCount = TRACE_ROW_GRADIENT_OKLAB_STOPS.length - 1;
  const segmentPosition = t * segmentCount;
  const startIndex = Math.floor(segmentPosition);
  const endIndex = Math.min(startIndex + 1, segmentCount);
  const localT = segmentPosition - startIndex;
  const [startL, startA, startB] = TRACE_ROW_GRADIENT_OKLAB_STOPS[startIndex];
  const [endL, endA, endB] = TRACE_ROW_GRADIENT_OKLAB_STOPS[endIndex];
  const l = lerp(startL, endL, localT);
  const a = lerp(startA, endA, localT);
  const b = lerp(startB, endB, localT);

  return `oklab(${formatOKLabChannel(l)} ${formatOKLabChannel(a)} ${formatOKLabChannel(b)} / ${formatOKLabChannel(clampedAlpha)})`;
}
