import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConversationListPanel, { formatRelativeTime, formatDuration } from './ConversationListPanel';
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
    expect(onSelect).toHaveBeenCalledWith('conv-1', undefined);
  });

  it('passes conversation title to onSelectConversation when available', () => {
    const onSelect = jest.fn();
    render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[makeConversation('conv-1', { conversation_title: 'Incident triage' })]}
        onSelectConversation={onSelect}
      />
    );
    fireEvent.click(screen.getByLabelText('select conversation conv-1'));
    expect(onSelect).toHaveBeenCalledWith('conv-1', 'Incident triage');
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

  it('prefers conversation title when present', () => {
    render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[makeConversation('conv-1', { conversation_title: 'Incident triage: payment webhook' })]}
      />
    );
    expect(screen.getByText('Incident triage: payment webhook')).toBeInTheDocument();
    expect(screen.queryByText(/^conv-1$/)).not.toBeInTheDocument();
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
      <ConversationListPanel {...defaultProps} conversations={[makeConversation('conv-1')]} showExtendedColumns />
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

  it('shows title plus truncated ID in extended mode when title is present', () => {
    render(
      <ConversationListPanel
        {...defaultProps}
        conversations={[
          makeConversation('conv-abcdef-1234567890', {
            conversation_title: 'Follow-up: outage postmortem',
          }),
        ]}
        showExtendedColumns
      />
    );
    expect(screen.getByText('Follow-up: outage postmortem')).toBeInTheDocument();
    expect(screen.getByText('conv-abc...')).toBeInTheDocument();
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

describe('formatRelativeTime', () => {
  it('returns "-" for invalid date', () => {
    expect(formatRelativeTime('not-a-date')).toBe('-');
  });

  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('just now');
  });

  it('returns minutes for timestamps < 60 min ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours for timestamps < 24h ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days for timestamps < 7d ago', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(formatRelativeTime(twoDaysAgo)).toBe('2d ago');
  });

  it('returns a date string for timestamps >= 7d ago', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const result = formatRelativeTime(twoWeeksAgo);
    expect(result).not.toContain('ago');
    expect(result).not.toBe('-');
  });

  it('returns "just now" for future timestamps', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(formatRelativeTime(future)).toBe('just now');
  });
});

describe('formatDuration', () => {
  it('returns "-" for invalid dates', () => {
    expect(formatDuration('invalid', '2026-03-04T12:00:00Z')).toBe('-');
    expect(formatDuration('2026-03-04T12:00:00Z', 'invalid')).toBe('-');
  });

  it('returns "-" for negative duration', () => {
    expect(formatDuration('2026-03-04T13:00:00Z', '2026-03-04T12:00:00Z')).toBe('-');
  });

  it('returns "< 1s" for zero duration', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-04T12:00:00Z')).toBe('< 1s');
  });

  it('returns seconds for durations under 1 minute', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-04T12:00:30Z')).toBe('30s');
  });

  it('returns minutes for durations under 1 hour', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-04T12:05:00Z')).toBe('5m');
  });

  it('returns hours and minutes for durations under 1 day', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-04T14:30:00Z')).toBe('2h 30m');
  });

  it('returns hours only when minutes are zero', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-04T15:00:00Z')).toBe('3h');
  });

  it('returns days and hours for long durations', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-06T15:00:00Z')).toBe('2d 3h');
  });

  it('returns days only when hours are zero', () => {
    expect(formatDuration('2026-03-04T12:00:00Z', '2026-03-06T12:00:00Z')).toBe('2d');
  });
});
