import { sortSavedConversationsNewestFirst } from './GenerationPicker';
import type { SavedConversation } from '../../evaluation/types';

function makeSavedConversation(savedID: string, createdAt: string): SavedConversation {
  return {
    tenant_id: 'tenant-1',
    saved_id: savedID,
    conversation_id: `conv-${savedID}`,
    name: savedID,
    source: 'telemetry',
    tags: {},
    saved_by: 'tester',
    created_at: createdAt,
    updated_at: createdAt,
    generation_count: 0,
    total_tokens: 0,
    agent_names: [],
  };
}

describe('sortSavedConversationsNewestFirst', () => {
  it('sorts by created_at descending', () => {
    const conversations = [
      makeSavedConversation('oldest', '2026-03-01T10:00:00Z'),
      makeSavedConversation('newest', '2026-03-03T09:00:00Z'),
      makeSavedConversation('middle', '2026-03-02T14:00:00Z'),
    ];

    const sorted = sortSavedConversationsNewestFirst(conversations);

    expect(sorted.map((conversation) => conversation.saved_id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('does not mutate the input array', () => {
    const conversations = [
      makeSavedConversation('a', '2026-03-01T10:00:00Z'),
      makeSavedConversation('b', '2026-03-03T09:00:00Z'),
    ];

    const snapshot = [...conversations];
    sortSavedConversationsNewestFirst(conversations);

    expect(conversations).toEqual(snapshot);
  });

  it('keeps invalid timestamps after valid ones while preserving relative order for ties', () => {
    const conversations = [
      makeSavedConversation('invalid-first', 'not-a-date'),
      makeSavedConversation('valid', '2026-03-03T09:00:00Z'),
      makeSavedConversation('invalid-second', 'also-not-a-date'),
    ];

    const sorted = sortSavedConversationsNewestFirst(conversations);

    expect(sorted.map((conversation) => conversation.saved_id)).toEqual(['valid', 'invalid-first', 'invalid-second']);
  });
});
