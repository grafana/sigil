export function toUnixSeconds(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value / 1000);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
  }
  if (typeof value === 'object' && typeof (value as { valueOf?: () => number }).valueOf === 'function') {
    const parsed = Number((value as { valueOf: () => number }).valueOf());
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
  }
  return undefined;
}
