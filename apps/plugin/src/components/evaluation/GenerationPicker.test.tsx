import React from 'react';
import { render, screen } from '@testing-library/react';
import type { ConversationsDataSource } from '../../conversation/api';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { SavedConversation } from '../../evaluation/types';
import GenerationPicker from './GenerationPicker';

function createSavedConversation(overrides: Partial<SavedConversation>): SavedConversation {
  return {
    tenant_id: 'tenant-1',
    saved_id: 'saved-id',
    conversation_id: 'conv-id',
    name: 'Saved conversation',
    source: 'telemetry',
    tags: {},
    saved_by: 'tester',
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('GenerationPicker', () => {
  it('sorts saved conversations by created_at descending before rendering', async () => {
    const saved = [
      createSavedConversation({
        saved_id: 'saved-middle',
        conversation_id: 'conv-middle',
        name: 'Middle',
        created_at: '2026-03-02T10:00:00Z',
      }),
      createSavedConversation({
        saved_id: 'saved-newest',
        conversation_id: 'conv-newest',
        name: 'Newest',
        created_at: '2026-03-03T10:00:00Z',
      }),
      createSavedConversation({
        saved_id: 'saved-missing-date',
        conversation_id: 'conv-missing-date',
        name: 'Missing timestamp',
        created_at: '',
      }),
    ];
    const evalDataSource: Partial<EvaluationDataSource> = {
      listSavedConversations: jest.fn(async () => ({ items: saved, next_cursor: '' })),
    };
    const convDataSource: Partial<ConversationsDataSource> = {
      listConversations: jest.fn(async () => ({ items: [] })),
      searchConversations: jest.fn(async () => ({ conversations: [], has_more: false })),
      getConversationDetail: jest.fn(async () => {
        throw new Error('not used');
      }),
      getGeneration: jest.fn(async () => {
        throw new Error('not used');
      }),
      getSearchTags: jest.fn(async () => []),
      getSearchTagValues: jest.fn(async () => []),
    };

    render(
      <GenerationPicker
        onSelect={() => {}}
        conversationsDataSource={convDataSource as ConversationsDataSource}
        evaluationDataSource={evalDataSource as EvaluationDataSource}
      />
    );

    const newestRow = await screen.findByText('Newest');
    const middleRow = await screen.findByText('Middle');
    const missingTimestampRow = await screen.findByText('Missing timestamp');

    const newestPos = newestRow.compareDocumentPosition(middleRow);
    expect(newestPos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const middlePos = middleRow.compareDocumentPosition(missingTimestampRow);
    expect(middlePos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(evalDataSource.listSavedConversations).toHaveBeenCalledWith(undefined, 50);
  });
});
