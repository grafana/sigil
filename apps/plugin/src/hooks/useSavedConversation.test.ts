import { act, renderHook, waitFor } from '@testing-library/react';
import type { EvaluationDataSource } from '../evaluation/api';
import type { SavedConversation, SavedConversationListResponse } from '../evaluation/types';
import { useSavedConversation } from './useSavedConversation';

function createSavedConversation(overrides?: Partial<SavedConversation>): SavedConversation {
  return {
    tenant_id: 'tenant-1',
    saved_id: 'saved-conv-1',
    conversation_id: 'conv-1',
    name: 'Conversation 1',
    source: 'telemetry',
    tags: {},
    saved_by: 'user',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    generation_count: 0,
    total_tokens: 0,
    agent_names: [],
    ...overrides,
  };
}

function createListResponse(items: SavedConversation[]): SavedConversationListResponse {
  return {
    items,
    next_cursor: '',
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

describe('useSavedConversation', () => {
  it('returns null when toggleSave is called while save is in flight', async () => {
    const saveDeferred = createDeferred<SavedConversation>();
    const evalDataSource = {
      getSavedConversation: jest.fn(async () => {
        throw new Error('not found');
      }),
      listSavedConversations: jest.fn(async () => createListResponse([])),
      saveConversation: jest.fn(async () => saveDeferred.promise),
      deleteSavedConversation: jest.fn(async () => undefined),
    } as unknown as EvaluationDataSource;

    const { result } = renderHook(() => useSavedConversation('conv-1', 'Conversation 1', evalDataSource));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.isSaved).toBe(false);

    let firstResult: boolean | null | undefined;
    let secondResult: boolean | null | undefined;

    await act(async () => {
      const firstPromise = result.current.toggleSave().then((value) => {
        firstResult = value;
      });
      const secondPromise = result.current.toggleSave().then((value) => {
        secondResult = value;
      });

      await Promise.resolve();
      expect(secondResult).toBeNull();

      saveDeferred.resolve(createSavedConversation({ saved_id: 'saved-conv-1', conversation_id: 'conv-1' }));
      await Promise.all([firstPromise, secondPromise]);
    });

    expect(firstResult).toBe(true);
    expect(evalDataSource.saveConversation).toHaveBeenCalledTimes(1);
    expect(result.current.isSaved).toBe(true);
  });
});
