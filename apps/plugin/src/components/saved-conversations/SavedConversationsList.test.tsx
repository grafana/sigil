import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SavedConversationsList } from './SavedConversationsList';
import { SavedConversation } from '../../evaluation/types';

const makeSC = (id: string, name: string): SavedConversation => ({
  tenant_id: 'test',
  saved_id: id,
  conversation_id: `conv-${id}`,
  name,
  source: 'telemetry',
  tags: {},
  saved_by: 'alice',
  created_at: '2026-03-10T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
  generation_count: 0,
  total_tokens: 0,
  agent_names: [],
});

describe('SavedConversationsList', () => {
  const onSelectionChange = jest.fn();
  const onAddToCollection = jest.fn();
  const onRemoveFromCollection = jest.fn();
  const onUnsave = jest.fn();
  const onPageChange = jest.fn();

  const conversations = [
    makeSC('s1', 'Auth flow edge case'),
    makeSC('s2', 'Rate limiting test'),
    makeSC('s3', 'Multi-turn hallucination'),
  ];

  const defaultProps = {
    conversations,
    isLoading: false,
    selectedIDs: new Set<string>(),
    onSelectionChange,
    activeCollectionID: null as string | null,
    onAddToCollection,
    onRemoveFromCollection,
    onUnsave,
    hasNextPage: false,
    hasPrevPage: false,
    onPageChange,
    pageSize: 25,
    onPageSizeChange: jest.fn(),
    searchQuery: '',
    onSearchChange: jest.fn(),
  };

  beforeEach(() => {
    onSelectionChange.mockReset();
    onAddToCollection.mockReset();
    onRemoveFromCollection.mockReset();
    onUnsave.mockReset();
    onPageChange.mockReset();
  });

  it('renders conversation names', () => {
    render(<SavedConversationsList {...defaultProps} />);
    expect(screen.getByText('Auth flow edge case')).toBeInTheDocument();
    expect(screen.getByText('Rate limiting test')).toBeInTheDocument();
  });

  it('calls onSelectionChange when a checkbox is toggled', () => {
    render(<SavedConversationsList {...defaultProps} />);
    const checkboxes = screen.getAllByRole('checkbox');
    // index 0 is the select-all checkbox
    fireEvent.click(checkboxes[1]);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['s1']));
  });

  it('shows selection toolbar when items are selected', () => {
    render(<SavedConversationsList {...defaultProps} selectedIDs={new Set(['s1', 's2'])} />);
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    expect(screen.getByText(/add to collection/i)).toBeInTheDocument();
  });

  it('hides Remove button when activeCollectionID is null', () => {
    render(<SavedConversationsList {...defaultProps} selectedIDs={new Set(['s1'])} activeCollectionID={null} />);
    expect(screen.queryByText(/remove from collection/i)).not.toBeInTheDocument();
  });

  it('shows Remove button when a collection is active', () => {
    render(<SavedConversationsList {...defaultProps} selectedIDs={new Set(['s1'])} activeCollectionID="col-1" />);
    expect(screen.getByText(/remove from collection/i)).toBeInTheDocument();
  });

  it('calls onRemoveFromCollection when Remove is clicked', () => {
    render(<SavedConversationsList {...defaultProps} selectedIDs={new Set(['s1', 's2'])} activeCollectionID="col-1" />);
    fireEvent.click(screen.getByText(/remove from collection/i));
    expect(onRemoveFromCollection).toHaveBeenCalledWith(new Set(['s1', 's2']));
  });

  it('filters rows by search query', () => {
    render(<SavedConversationsList {...defaultProps} searchQuery="Rate" />);
    expect(screen.getByText('Rate limiting test')).toBeInTheDocument();
    expect(screen.queryByText('Auth flow edge case')).not.toBeInTheDocument();
  });

  it('shows loading spinner when isLoading is true', () => {
    render(<SavedConversationsList {...defaultProps} conversations={[]} isLoading />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('selects all visible rows on select-all click', () => {
    render(<SavedConversationsList {...defaultProps} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['s1', 's2', 's3']));
  });

  it('calls onAddToCollection when Add to collection is clicked', () => {
    render(<SavedConversationsList {...defaultProps} selectedIDs={new Set(['s1'])} />);
    fireEvent.click(screen.getByText(/add to collection/i));
    expect(onAddToCollection).toHaveBeenCalled();
  });

  it('shows — for empty agent_names', () => {
    const noAgents = { ...makeSC('s4', 'No agents'), agent_names: [] };
    render(<SavedConversationsList {...defaultProps} conversations={[noAgents]} />);
    // Empty agents, gens, and tokens all show '—'
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it('shows agent names and enrichment data', () => {
    const rich = {
      ...makeSC('s5', 'Rich conv'),
      agent_names: ['agent-a', 'agent-b'],
      generation_count: 4,
      total_tokens: 1234,
    };
    render(<SavedConversationsList {...defaultProps} conversations={[rich]} />);
    expect(screen.getByText('agent-a')).toBeInTheDocument();
    expect(screen.getByText('agent-b')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('conversation name is a link to the explore page', () => {
    render(<SavedConversationsList {...defaultProps} />);
    const link = screen.getByRole('link', { name: 'Auth flow edge case' });
    expect(link).toHaveAttribute('href', expect.stringContaining('conv-s1'));
    expect(link).toHaveAttribute('target', '_blank');
  });
});
