type FormatDateShortOptions = {
  fallback?: string;
  format?: Intl.DateTimeFormatOptions;
};

export function formatDateShort(iso: string, options: FormatDateShortOptions = {}): string {
  const { fallback = 'n/a', format } = options;
  if (!iso) {
    return fallback;
  }

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() <= 1) {
    return fallback;
  }
  return parsed.toLocaleDateString(undefined, format);
}
