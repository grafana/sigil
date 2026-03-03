const EMPTY_VALUE = '—';

export function formatTokens(value?: number): string {
  if (value == null || !Number.isFinite(value)) {
    return EMPTY_VALUE;
  }
  return Math.round(value).toLocaleString();
}

export function formatCostUsd(value?: number): string {
  if (value == null || !Number.isFinite(value)) {
    return EMPTY_VALUE;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatLatency(valueMs?: number): string {
  if (valueMs == null || !Number.isFinite(valueMs)) {
    return EMPTY_VALUE;
  }
  if (valueMs < 1000) {
    return `${Math.round(valueMs)} ms`;
  }
  const seconds = valueMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
}
