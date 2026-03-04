import React from 'react';
import { render, screen } from '@testing-library/react';
import ConversationSummaryHeader from './ConversationSummaryHeader';
import type { ConversationSearchResult } from '../../conversation/types';

function makeConversation(overrides?: Partial<ConversationSearchResult>): ConversationSearchResult {
  return {
    conversation_id: 'conv-1',
    generation_count: 3,
    first_generation_at: '2026-02-15T09:00:00Z',
    last_generation_at: '2026-02-15T10:00:00Z',
    models: ['gpt-4o'],
    agents: ['assistant'],
    error_count: 0,
    has_errors: false,
    trace_ids: ['trace-1'],
    annotation_count: 0,
    ...overrides,
  };
}

describe('ConversationSummaryHeader', () => {
  it('shows conversation title and keeps id visible when title is present', () => {
    render(
      <ConversationSummaryHeader
        conversation={makeConversation({ conversation_title: 'Incident: authentication failures' })}
      />
    );

    expect(screen.getByText('Incident: authentication failures')).toBeInTheDocument();
    expect(screen.getByText('conv-1')).toBeInTheDocument();
  });

  it('uses "Conversation" label when title is present', () => {
    render(
      <ConversationSummaryHeader
        conversation={makeConversation({ conversation_title: 'Incident: authentication failures' })}
      />
    );

    expect(screen.getByText('Conversation')).toBeInTheDocument();
    expect(screen.queryByText('Conversation ID')).not.toBeInTheDocument();
  });

  it('falls back to conversation id when title is empty', () => {
    render(<ConversationSummaryHeader conversation={makeConversation()} />);

    expect(screen.getByText('conv-1')).toBeInTheDocument();
  });

  it('uses "Conversation ID" label when no title is present', () => {
    render(<ConversationSummaryHeader conversation={makeConversation()} />);

    expect(screen.getByText('Conversation ID')).toBeInTheDocument();
  });
});
