import type { GenerationDetail } from '../generation/types';
import { resolveConversationTitleFromTelemetry } from './conversationTitle';
import type { ConversationSpan, SpanAttributeValue } from './types';

function makeGeneration(overrides: Partial<GenerationDetail> = {}): GenerationDetail {
  return {
    generation_id: 'gen-1',
    conversation_id: 'conv-1',
    ...overrides,
  };
}

function attrs(entries: Array<[string, SpanAttributeValue]> = []): ReadonlyMap<string, SpanAttributeValue> {
  return new Map(entries);
}

function makeSpan(overrides: Partial<ConversationSpan> = {}): ConversationSpan {
  return {
    traceID: 'trace-1',
    spanID: 'span-1',
    parentSpanID: '',
    name: 'span',
    kind: 'INTERNAL',
    serviceName: 'svc',
    startTimeUnixNano: BigInt(1),
    endTimeUnixNano: BigInt(2),
    durationNano: BigInt(1),
    attributes: attrs(),
    resourceAttributes: attrs(),
    generation: null,
    children: [],
    ...overrides,
  };
}

describe('resolveConversationTitleFromTelemetry', () => {
  it('reads title from generation metadata', () => {
    const title = resolveConversationTitleFromTelemetry(
      [makeGeneration({ metadata: { 'sigil.conversation.title': 'Incident: auth failures' } })],
      []
    );

    expect(title).toBe('Incident: auth failures');
  });

  it('reads title from span attributes when metadata is absent', () => {
    const span = makeSpan({
      attributes: attrs([['sigil.conversation.title', { stringValue: 'Checkout retry investigation' }]]),
    });

    const title = resolveConversationTitleFromTelemetry([], [span]);
    expect(title).toBe('Checkout retry investigation');
  });

  it('reads title from resource attributes and nested children', () => {
    const child = makeSpan({
      spanID: 'child',
      parentSpanID: 'span-1',
      resourceAttributes: attrs([['sigil.conversation.title', { stringValue: 'Fraud scoring timeout' }]]),
    });
    const root = makeSpan({ children: [child] });

    const title = resolveConversationTitleFromTelemetry([], [root]);
    expect(title).toBe('Fraud scoring timeout');
  });

  it('prefers generation metadata over span attributes', () => {
    const generation = makeGeneration({ metadata: { 'sigil.conversation.title': 'Conversation title from metadata' } });
    const span = makeSpan({
      attributes: attrs([['sigil.conversation.title', { stringValue: 'Span title' }]]),
    });

    const title = resolveConversationTitleFromTelemetry([generation], [span]);
    expect(title).toBe('Conversation title from metadata');
  });

  it('returns null when title is missing or blank', () => {
    const generation = makeGeneration({ metadata: { 'sigil.conversation.title': '   ' } });
    const span = makeSpan({
      attributes: attrs([['sigil.conversation.title', { stringValue: '' }]]),
    });

    const title = resolveConversationTitleFromTelemetry([generation], [span]);
    expect(title).toBeNull();
  });
});

