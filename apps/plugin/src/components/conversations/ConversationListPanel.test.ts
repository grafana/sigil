import { formatRelativeTime, formatDuration } from './ConversationListPanel';

describe('formatRelativeTime', () => {
  it('returns "-" for invalid date', () => {
    expect(formatRelativeTime('not-a-date')).toBe('-');
  });

  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('just now');
  });

  it('returns minutes for timestamps < 60 min ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours for timestamps < 24h ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days for timestamps < 7d ago', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(formatRelativeTime(twoDaysAgo)).toBe('2d ago');
  });

  it('returns a date string for timestamps >= 7d ago', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const result = formatRelativeTime(twoWeeksAgo);
    expect(result).not.toContain('ago');
    expect(result).not.toBe('-');
  });

  it('returns "just now" for future timestamps', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(formatRelativeTime(future)).toBe('just now');
  });
});

describe('formatDuration', () => {
  it('returns "-" for invalid dates', () => {
    expect(formatDuration('invalid', '2026-03-04T12:00:00Z')).toBe('-');
    expect(formatDuration('2026-03-04T12:00:00Z', 'invalid')).toBe('-');
  });

  it('returns "-" for negative duration', () => {
    expect(formatDuration('2026-03-04T13:00:00Z', '2026-03-04T12:00:00Z')).toBe('-');
  });

  it('returns "< 1s" for zero duration', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-04T12:00:00Z')).toBe('< 1s');
  });

  it('returns seconds for durations under 1 minute', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-04T12:00:30Z')).toBe('30s');
  });

  it('returns minutes for durations under 1 hour', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-04T12:05:00Z')).toBe('5m');
  });

  it('returns hours and minutes for durations under 1 day', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-04T14:30:00Z')).toBe('2h 30m');
  });

  it('returns hours only when minutes are zero', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-04T15:00:00Z')).toBe('3h');
  });

  it('returns days and hours for long durations', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-06T15:00:00Z')).toBe('2d 3h');
  });

  it('returns days only when hours are zero', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-06T12:00:00Z')).toBe('2d');
  });
});
