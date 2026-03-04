import React from 'react';
import { dateTime, makeTimeRange } from '@grafana/data';
import {
  ConversationTimelineHistogram,
  type ConversationTimelineHistogramProps,
} from '../components/conversations/ConversationTimelineHistogram';
import type { ConversationSearchResult } from '../conversation/types';

function generateMockConversations(count: number, fromMs: number, toMs: number): ConversationSearchResult[] {
  const results: ConversationSearchResult[] = [];
  for (let i = 0; i < count; i++) {
    const ts = fromMs + Math.random() * (toMs - fromMs);
    const hasError = Math.random() < 0.15;
    results.push({
      conversation_id: `conv-${i.toString().padStart(4, '0')}`,
      generation_count: Math.floor(Math.random() * 20) + 1,
      first_generation_at: new Date(ts - Math.random() * 600_000).toISOString(),
      last_generation_at: new Date(ts).toISOString(),
      models: ['claude-sonnet-4-6'],
      agents: ['assistant'],
      error_count: hasError ? Math.floor(Math.random() * 5) + 1 : 0,
      has_errors: hasError,
      trace_ids: [`trace-${i}`],
      annotation_count: 0,
    });
  }
  return results;
}

const now = Date.now();
const oneHourAgo = now - 3_600_000;
const defaultRange = makeTimeRange(dateTime(oneHourAgo), dateTime(now));
const mockConversations = generateMockConversations(80, oneHourAgo, now);

const meta = {
  title: 'Sigil/Conversations/ConversationTimelineHistogram',
  component: ConversationTimelineHistogram,
};

export default meta;

export const Default = {
  args: {
    conversations: mockConversations,
    timeRange: defaultRange,
    loading: false,
  } satisfies ConversationTimelineHistogramProps,
};

export const Loading = {
  args: {
    conversations: [],
    timeRange: defaultRange,
    loading: true,
  } satisfies ConversationTimelineHistogramProps,
};

export const Empty = {
  args: {
    conversations: [],
    timeRange: defaultRange,
    loading: false,
  } satisfies ConversationTimelineHistogramProps,
};

export const FewConversations = {
  render: () => {
    const fewConvs = generateMockConversations(5, oneHourAgo, now);
    return (
      <div style={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
        <ConversationTimelineHistogram conversations={fewConvs} timeRange={defaultRange} loading={false} />
      </div>
    );
  },
};
