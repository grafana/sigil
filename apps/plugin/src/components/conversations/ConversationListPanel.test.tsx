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

  it('shows relative time and conversation ID for each row', () => {
    render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[makeConversation('conv-1', { last_generation_at: '2026-02-15T10:00:00Z' })]}
      />
    );
    expect(screen.getByText('conv-1')).toBeInTheDocument();
    expect(screen.getByText(/ago|just now|Feb|Mar|Jan/)).toBeInTheDocument();
  });

  it('does not render day header rows in compact mode', () => {
    render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[
          makeConversation('conv-1', { last_generation_at: '2026-02-15T10:00:00Z' }),
          makeConversation('conv-2', { last_generation_at: '2026-02-14T09:00:00Z' }),
        ]}
      />
    );
    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(2);
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

  it('does not render a table header in compact mode', () => {
    render(<ConversationListPanel {...defaultProps} conversations={[makeConversation('conv-1')]} />);
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });

  it('renders extended columns header when showExtendedColumns is true', () => {
    render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[makeConversation('conv-1')]}
        showExtendedColumns
      />
    );
    expect(screen.getByText('Last activity')).toBeInTheDocument();
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Models')).toBeInTheDocument();
    expect(screen.getByText('Quality')).toBeInTheDocument();
  });

  it('shows truncated conversation ID with copy button in extended mode', () => {
    render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[makeConversation('conv-abcdef-1234567890')]}
        showExtendedColumns
      />
    );
    expect(screen.getByText('conv-abc...')).toBeInTheDocument();
    expect(screen.getByLabelText('copy conversation id')).toBeInTheDocument();
  });

  it('applies error border class for rows with errors', () => {
    const { container } = render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[makeConversation('conv-err', { has_errors: true, error_count: 3 })]}
        showExtendedColumns
      />
    );
    const row = container.querySelector('tr[role="button"]');
    expect(row?.className).toContain('rowError');
  });
});
