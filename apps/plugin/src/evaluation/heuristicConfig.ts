export function normalizeHeuristicStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function formatHeuristicStringList(value: unknown): string {
  return normalizeHeuristicStringList(value).join('\n');
}

export function parseHeuristicStringListInput(value: string): string[] | undefined {
  const items = normalizeHeuristicStringList(value);
  return items.length > 0 ? items : undefined;
}
