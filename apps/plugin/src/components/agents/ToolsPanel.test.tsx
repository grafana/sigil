import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ToolsPanel from './ToolsPanel';
import type { AgentTool } from '../../agents/types';

const tools: AgentTool[] = [
  {
    name: 'async_lookup',
    description: 'Deferred lookup tool',
    type: 'function',
    input_schema_json: '{"type":"object","properties":{"query":{"type":"string"}}}',
    deferred: true,
    token_estimate: 42,
  },
  {
    name: 'sync_lookup',
    description: 'Immediate lookup tool',
    type: 'function',
    input_schema_json: '{"type":"object","properties":{"query":{"type":"string"}}}',
    deferred: false,
    token_estimate: 25,
  },
];

describe('ToolsPanel', () => {
  it('shows deferred tool metadata in list and detail', () => {
    render(<ToolsPanel tools={tools} />);

    expect(screen.getByText('Execution mode:')).toBeInTheDocument();
    expect(screen.getByText('Deferred')).toBeInTheDocument();
    expect(screen.getByLabelText('deferred tool')).toBeInTheDocument();
    expect(screen.queryByText(/^DEFERRED$/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /select tool sync_lookup/i }));

    expect(screen.getByText('Immediate')).toBeInTheDocument();
  });
});
