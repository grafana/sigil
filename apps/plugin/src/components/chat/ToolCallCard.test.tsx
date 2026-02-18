import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ToolCallCard from './ToolCallCard';

describe('ToolCallCard', () => {
  it('shows tool name badge', () => {
    render(<ToolCallCard toolCall={{ id: 'tc-1', name: 'search' }} />);
    expect(screen.getByText('search')).toBeInTheDocument();
  });

  it('shows tool call id', () => {
    render(<ToolCallCard toolCall={{ id: 'tc-123', name: 'search' }} />);
    expect(screen.getByText('tc-123')).toBeInTheDocument();
  });

  it('shows pretty-printed JSON input on expand', () => {
    render(<ToolCallCard toolCall={{ id: 'tc-1', name: 'search', input_json: '{"query":"test"}' }} />);
    fireEvent.click(screen.getByLabelText('tool call search'));
    expect(screen.getByText(/"query": "test"/)).toBeInTheDocument();
  });

  it('handles missing input_json gracefully', () => {
    render(<ToolCallCard toolCall={{ id: 'tc-1', name: 'fetch' }} />);
    expect(screen.getByText('fetch')).toBeInTheDocument();
  });
});
