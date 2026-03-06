export function bucketValues(values: number[], targetCount: number): number[] {
  if (values.length === 0 || targetCount <= 0) {
    return [];
  }
  return Array.from({ length: targetCount }, (_, i) => {
    const start = Math.floor((i * values.length) / targetCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / targetCount));
    const slice = values.slice(start, end);
    const sum = slice.reduce((acc, value) => acc + value, 0);
    return sum / slice.length;
  });
}

export function normalizeValuesToHeights(values: number[], targetCount: number): number[] {
  if (values.length === 0 || targetCount <= 0) {
    return [];
  }
  const bucketed = bucketValues(values, targetCount);
  const minValue = Math.min(...bucketed);
  const maxValue = Math.max(...bucketed);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return [];
  }
  if (Math.abs(maxValue - minValue) < 1e-9) {
    return bucketed.map(() => 60);
  }
  const minHeight = 20;
  const maxHeight = 100;
  return bucketed.map((value) => {
    const t = (value - minValue) / (maxValue - minValue);
    return minHeight + t * (maxHeight - minHeight);
  });
}
