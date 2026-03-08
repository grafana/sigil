import { formatDateShort } from './date';

describe('formatDateShort', () => {
  it('formats a valid date with caller options', () => {
    const iso = '2026-03-08T10:00:00Z';
    const format: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };

    expect(formatDateShort(iso, { fallback: '—', format })).toBe(new Date(iso).toLocaleDateString(undefined, format));
  });

  it('returns fallback for empty, invalid, and year-zero dates', () => {
    expect(formatDateShort('', { fallback: '—' })).toBe('—');
    expect(formatDateShort('not-a-date', { fallback: '—' })).toBe('—');
    expect(formatDateShort('0001-01-01T00:00:00Z', { fallback: '—' })).toBe('—');
  });

  it('keeps n/a as default fallback', () => {
    expect(formatDateShort('not-a-date')).toBe('n/a');
  });
});
