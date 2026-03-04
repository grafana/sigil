const SERVICE_COLORS = [
  '#7EB26D',
  '#EAB839',
  '#6ED0E0',
  '#EF843C',
  '#1F78C1',
  '#BA43A9',
  '#705DA0',
  '#508642',
  '#CCA300',
  '#447EBC',
  '#C15C17',
  '#0A437C',
  '#6D1F62',
  '#584477',
  '#B7DBAB',
  '#F4D598',
  '#70DBED',
  '#F9BA8F',
  '#82B5D8',
  '#E5A8E2',
  '#AEA2E0',
];

function nextIndex(index: number): number {
  return index + 1 < SERVICE_COLORS.length ? index + 1 : 0;
}

export function buildServiceColorMap(services: string[]): Map<string, string> {
  const map = new Map<string, string>();
  let nextColorIndex = 0;

  for (const service of services) {
    if (map.has(service)) {
      continue;
    }
    map.set(service, SERVICE_COLORS[nextColorIndex]);
    nextColorIndex = nextIndex(nextColorIndex);
  }

  return map;
}

export function withAlpha(hexColor: string, alphaHex = 'CF'): string {
  if (hexColor.length === 7) {
    return `${hexColor}${alphaHex}`;
  }
  return hexColor;
}
