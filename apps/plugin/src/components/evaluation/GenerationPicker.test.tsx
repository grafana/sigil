import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GenerationPicker, { sortSavedConversationsNewestFirst } from './GenerationPicker';
import type { ConversationsDataSource } from '../../conversation/api';
import type { ConversationDetailPage } from '../../conversation/types';
import type { EvaluationDataSource } from '../../evaluation/api';
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
  };
}

function makeConversationDetailPage(
  conversationID: string,
  generationID: string,
  overrides: Partial<ConversationDetailPage> = {}
): ConversationDetailPage {
  return {
    conversation_id: conversationID,
    generation_count: 1,
    first_generation_at: '2026-03-01T10:00:00Z',
    last_generation_at: '2026-03-01T10:00:00Z',
    has_more: false,
    next_cursor: undefined,
    generations: [
      {
        generation_id: generationID,
        conversation_id: conversationID,
        model: { provider: 'openai', name: 'gpt-4o' },
        created_at: '2026-03-01T10:00:00Z',
        messages: [],
      } as never,
    ],
    annotations: [],
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPicker({
  getConversationDetail,
}: {
  getConversationDetail: ConversationsDataSource['getConversationDetail'];
}) {
  const conversationsDataSource = {
    listConversations: jest.fn(async () => ({ items: [] })),
    searchConversations: jest.fn(async () => ({ conversations: [], has_more: false })),
    getConversationDetail,
  } as unknown as ConversationsDataSource;
  const evaluationDataSource = {
    listSavedConversations: jest.fn(async () => ({
      items: [
        makeSavedConversation('saved-1', '2026-03-01T10:00:00Z'),
        makeSavedConversation('saved-2', '2026-03-02T10:00:00Z'),
      ],
      next_cursor: '',
    })),
    listCollections: jest.fn(async () => ({ items: [], next_cursor: '' })),
  } as unknown as EvaluationDataSource;

  render(
    <GenerationPicker
      onSelect={jest.fn()}
      conversationsDataSource={conversationsDataSource}
      evaluationDataSource={evaluationDataSource}
    />
  );
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

describe('GenerationPicker', () => {
  it('ignores stale initial detail responses after a different conversation is selected', async () => {
    const firstDetail = createDeferred<ConversationDetailPage>();

    renderPicker({
      getConversationDetail: jest.fn((conversationID: string) => {
        if (conversationID === 'conv-saved-1') {
          return firstDetail.promise;
        }
        return Promise.resolve(makeConversationDetailPage(conversationID, 'gen-current'));
      }),
    });

    await waitFor(() => expect(screen.getByText('saved-2')).toBeInTheDocument());

    fireEvent.click(screen.getByText('saved-1'));
    fireEvent.click(screen.getByText('saved-2'));

    await screen.findByText('gen-current');

    await act(async () => {
      firstDetail.resolve(makeConversationDetailPage('conv-saved-1', 'gen-stale'));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText('gen-current')).toBeInTheDocument());
    expect(screen.queryByText('gen-stale')).not.toBeInTheDocument();
  });

  it('ignores stale load-more responses after switching conversations', async () => {
    const olderPage = createDeferred<ConversationDetailPage>();

    renderPicker({
      getConversationDetail: jest.fn((conversationID: string, options?: { cursor?: string; limit?: number }) => {
        if (conversationID === 'conv-saved-1' && options?.cursor === 'page-2') {
          return olderPage.promise;
        }
        if (conversationID === 'conv-saved-1') {
          return Promise.resolve(
            makeConversationDetailPage('conv-saved-1', 'gen-initial', {
              has_more: true,
              next_cursor: 'page-2',
            })
          );
        }
        return Promise.resolve(makeConversationDetailPage(conversationID, 'gen-current'));
      }),
    });

    await waitFor(() => expect(screen.getByText('saved-2')).toBeInTheDocument());

    fireEvent.click(screen.getByText('saved-1'));
    await screen.findByText('gen-initial');

    fireEvent.click(screen.getByRole('button', { name: 'Load more generations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByText('saved-2'));
    await screen.findByText('gen-current');

    await act(async () => {
      olderPage.resolve(
        makeConversationDetailPage('conv-saved-1', 'gen-older', {
          has_more: false,
        })
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText('gen-current')).toBeInTheDocument());
    expect(screen.queryByText('gen-older')).not.toBeInTheDocument();
  });
});
