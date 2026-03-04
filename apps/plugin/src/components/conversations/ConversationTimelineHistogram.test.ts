import type { ConversationSearchResult } from '../../conversation/types';
import { bucketConversations, computeBucketCount } from './ConversationTimelineHistogram';

function makeConv(lastGenerationAt: string): ConversationSearchResult {
  return {
    conversation_id: `conv-${lastGenerationAt}`,
    generation_count: 1,
    first_generation_at: lastGenerationAt,
    last_generation_at: lastGenerationAt,
    models: [],
    agents: [],
    error_count: 0,
    has_errors: false,
    trace_ids: [],
    annotation_count: 0,
  };
}

describe('bucketConversations', () => {
  it('returns empty arrays for empty conversations', () => {
    const result = bucketConversations([], 0, 60_000, 5);
    expect(result.times).toHaveLength(5);
    expect(result.counts).toEqual([0, 0, 0, 0, 0]);
  });

  it('returns empty arrays when bucketCount is 0', () => {
    const result = bucketConversations([], 0, 60_000, 0);
    expect(result.times).toHaveLength(0);
    expect(result.counts).toHaveLength(0);
  });

  it('returns empty arrays when range is invalid', () => {
    const result = bucketConversations([], 60_000, 0, 5);
    expect(result.times).toHaveLength(0);
  });

  it('places a single conversation in the correct bucket', () => {
    const from = Date.parse('2026-03-04T12:00:00Z');
    const to = Date.parse('2026-03-04T13:00:00Z');
    const conv = makeConv('2026-03-04T12:10:00Z');

    const result = bucketConversations([conv], from, to, 4);
    expect(result.counts).toEqual([1, 0, 0, 0]);
  });

  it('distributes conversations across buckets', () => {
    const from = Date.parse('2026-03-04T12:00:00Z');
    const to = Date.parse('2026-03-04T13:00:00Z');
    const convs = [
      makeConv('2026-03-04T12:05:00Z'),
      makeConv('2026-03-04T12:10:00Z'),
      makeConv('2026-03-04T12:35:00Z'),
      makeConv('2026-03-04T12:55:00Z'),
    ];

    const result = bucketConversations(convs, from, to, 4);
    expect(result.counts).toEqual([2, 0, 1, 1]);
  });

  it('counts error conversations in totals', () => {
    const from = Date.parse('2026-03-04T12:00:00Z');
    const to = Date.parse('2026-03-04T13:00:00Z');
    const convs = [
      makeConv('2026-03-04T12:05:00Z'),
      makeConv('2026-03-04T12:10:00Z'),
      makeConv('2026-03-04T12:35:00Z'),
    ];

    const result = bucketConversations(convs, from, to, 4);
    expect(result.counts).toEqual([2, 0, 1, 0]);
  });

  it('clamps conversations at range boundaries', () => {
    const from = Date.parse('2026-03-04T12:00:00Z');
    const to = Date.parse('2026-03-04T13:00:00Z');
    const convs = [makeConv('2026-03-04T11:00:00Z'), makeConv('2026-03-04T14:00:00Z')];

    const result = bucketConversations(convs, from, to, 4);
    expect(result.counts).toEqual([1, 0, 0, 1]);
  });

  it('places a conversation exactly at the end into the last bucket', () => {
    const from = Date.parse('2026-03-04T12:00:00Z');
    const to = Date.parse('2026-03-04T13:00:00Z');
    const conv = makeConv('2026-03-04T13:00:00Z');

    const result = bucketConversations([conv], from, to, 4);
    expect(result.counts).toEqual([0, 0, 0, 1]);
  });

  it('skips conversations with invalid timestamps', () => {
    const from = Date.parse('2026-03-04T12:00:00Z');
    const to = Date.parse('2026-03-04T13:00:00Z');
    const conv = makeConv('not-a-date');

    const result = bucketConversations([conv], from, to, 4);
    expect(result.counts).toEqual([0, 0, 0, 0]);
  });

  it('sets bucket times to midpoints', () => {
    const result = bucketConversations([], 0, 100, 4);
    expect(result.times).toEqual([12.5, 37.5, 62.5, 87.5]);
  });
});

describe('computeBucketCount', () => {
  it('returns minimum buckets for very short ranges', () => {
    expect(computeBucketCount(60_000)).toBe(12);
  });

  it('returns 20 for sub-hour ranges', () => {
    expect(computeBucketCount(30 * 60_000)).toBe(20);
  });

  it('returns 30 for multi-hour ranges', () => {
    expect(computeBucketCount(3 * 3_600_000)).toBe(30);
  });

  it('returns 40 for day-long ranges', () => {
    expect(computeBucketCount(12 * 3_600_000)).toBe(40);
  });

  it('returns max buckets for multi-day ranges', () => {
    expect(computeBucketCount(3 * 86_400_000)).toBe(60);
  });
});
