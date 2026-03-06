import type { ConversationData, ConversationSpan, SpanAttributeValue } from './types';
import { resolveConversationUserId } from './userIdentity';

function makeAttrs(entries: Array<[string, SpanAttributeValue]>): ReadonlyMap<string, SpanAttributeValue> {
  return new Map(entries);
}

function makeSpan(overrides: Partial<ConversationSpan> = {}): ConversationSpan {
  return {
    traceID: 'trace-1',
    spanID: 'span-1',
    parentSpanID: '',
    name: 'span',
    kind: 'CLIENT',
    serviceName: 'svc',
    startTimeUnixNano: BigInt(1),
    endTimeUnixNano: BigInt(2),
    durationNano: BigInt(1),
    attributes: new Map(),
    resourceAttributes: new Map(),
    generation: null,
    children: [],
    ...overrides,
  };
}

function makeConversationData(overrides: Partial<ConversationData> = {}): ConversationData {
  return {
    conversationID: 'conv-1',
    generationCount: 1,
    firstGenerationAt: '2026-03-06T00:00:00Z',
    lastGenerationAt: '2026-03-06T00:00:00Z',
    ratingSummary: null,
    annotations: [],
    spans: [],
    orphanGenerations: [],
    ...overrides,
  };
}

describe('resolveConversationUserId', () => {
  it('prefers the conversation-level user id over span attributes', () => {
    const data = makeConversationData({
      userID: 'jess@example.com',
      spans: [
        makeSpan({
          attributes: makeAttrs([['user.id', { stringValue: '2557' }]]),
        }),
      ],
    });

    expect(resolveConversationUserId(data)).toBe('jess@example.com');
  });

  it('prefers email-like span values over numeric fallback values', () => {
    const data = makeConversationData({
      spans: [
        makeSpan({
          spanID: 'span-1',
          attributes: makeAttrs([['user.id', { stringValue: '2557' }]]),
        }),
        makeSpan({
          spanID: 'span-2',
          attributes: makeAttrs([['user.id', { stringValue: 'jess@example.com' }]]),
        }),
      ],
    });

    expect(resolveConversationUserId(data)).toBe('jess@example.com');
  });
});
