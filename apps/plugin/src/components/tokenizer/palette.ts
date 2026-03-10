const TOKEN_COLORS = [
  'oklch(0.75 0.15 30)', // coral
  'oklch(0.75 0.15 90)', // gold
  'oklch(0.75 0.15 150)', // green
  'oklch(0.75 0.15 210)', // teal
  'oklch(0.75 0.15 270)', // blue
  'oklch(0.75 0.15 330)', // pink
  'oklch(0.70 0.12 60)', // amber
  'oklch(0.70 0.12 120)', // lime
  'oklch(0.70 0.12 180)', // cyan
  'oklch(0.70 0.12 240)', // indigo
] as const;

export function tokenColor(index: number): string {
  const len = TOKEN_COLORS.length;
  return TOKEN_COLORS[((index % len) + len) % len];
}
