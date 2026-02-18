import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConversationListPanel from './ConversationListPanel';
import type { ConversationSearchResult } from '../../conversation/types';

function makeConversation(id: string, overrides?: Partial<ConversationSearchResult>): ConversationSearchResult {
  return {
    conversation_id: id,
    generation_count: 2,
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

describe('ConversationListPanel', () => {
  const defaultProps = {
    selectedConversationId: '',
    loading: false,
    hasMore: false,
    loadingMore: false,
    onSelectConversation: jest.fn(),
    onLoadMore: jest.fn(),
  };

  it('renders all conversations', () => {
    const conversations = [makeConversation('conv-1'), makeConversation('conv-2')];
    render(<ConversationListPanel {...defaultProps} conversations={conversations} />);
    expect(screen.getByLabelText('select conversation conv-1')).toBeInTheDocument();
    expect(screen.getByLabelText('select conversation conv-2')).toBeInTheDocument();
  });

  it('calls onSelectConversation when a row is clicked', () => {
    const onSelect = jest.fn();
    render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[makeConversation('conv-1')]}
        onSelectConversation={onSelect}
      />
    );
    fireEvent.click(screen.getByLabelText('select conversation conv-1'));
    expect(onSelect).toHaveBeenCalledWith('conv-1');
  });

  it('shows error badge when error_count > 0', () => {
    render(
      <ConversationListPanel {...defaultProps} conversations={[makeConversation('conv-1', { error_count: 3 })]} />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows model badges', () => {
    render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[makeConversation('conv-1', { models: ['gpt-4o', 'claude-3'] })]}
      />
    );
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    expect(screen.getByText('claude-3')).toBeInTheDocument();
  });

  it('shows load more button when hasMore is true', () => {
    render(<ConversationListPanel {...defaultProps} conversations={[makeConversation('conv-1')]} hasMore={true} />);
    expect(screen.getByLabelText('load more conversations')).toBeInTheDocument();
  });

  it('calls onLoadMore when load more is clicked', () => {
    const onLoadMore = jest.fn();
    render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[makeConversation('conv-1')]}
        hasMore={true}
        onLoadMore={onLoadMore}
      />
    );
    fireEvent.click(screen.getByLabelText('load more conversations'));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('shows spinner when loading', () => {
    render(<ConversationListPanel {...defaultProps} conversations={[]} loading={true} />);
    expect(screen.getByTestId('Spinner')).toBeInTheDocument();
  });

  it('shows empty state when no conversations', () => {
    render(<ConversationListPanel {...defaultProps} conversations={[]} />);
    expect(screen.getByText(/no conversations found/i)).toBeInTheDocument();
  });

  it('shows rating icons when rating_summary present', () => {
    const conv = makeConversation('conv-1', {
      generation_count: 5,
      rating_summary: { total_count: 3, good_count: 2, bad_count: 1, has_bad_rating: true },
    });
    render(<ConversationListPanel {...defaultProps} conversations={[conv]} />);
    // good_count shows 2, bad_count shows 1
    expect(screen.getAllByText('2')).toHaveLength(1);
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
