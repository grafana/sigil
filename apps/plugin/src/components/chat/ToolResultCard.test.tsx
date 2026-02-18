import React from 'react';
import { render, screen } from '@testing-library/react';
import ToolResultCard from './ToolResultCard';

describe('ToolResultCard', () => {
  it('shows success icon for non-error results', () => {
    render(<ToolResultCard toolResult={{ tool_call_id: 'tc-1', name: 'search', content: 'found 3 results' }} />);
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('found 3 results')).toBeInTheDocument();
  });

  it('shows error styling for is_error results', () => {
    render(
      <ToolResultCard toolResult={{ tool_call_id: 'tc-1', name: 'search', content: 'timeout', is_error: true }} />
    );
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
  });

  it('renders decoded content_json as formatted JSON', () => {
    render(<ToolResultCard toolResult={{ tool_call_id: 'tc-1', name: 'api', content_json: '{"status":"ok"}' }} />);
    expect(screen.getByText(/"status": "ok"/)).toBeInTheDocument();
  });

  it('shows tool_call_id reference', () => {
    render(<ToolResultCard toolResult={{ tool_call_id: 'tc-42', name: 'search', content: 'data' }} />);
    expect(screen.getByText('tc-42')).toBeInTheDocument();
  });
});
