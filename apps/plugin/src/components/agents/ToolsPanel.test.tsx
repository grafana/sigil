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

  it('parses base64-encoded tool schemas', () => {
    const encodedSchema = btoa('{"type":"object","properties":{"city":{"type":"string"}}}');
    render(
      <ToolsPanel
        tools={[
          {
            name: 'encoded_tool',
            description: 'Encoded schema tool',
            type: 'function',
            input_schema_json: encodedSchema,
            deferred: false,
            token_estimate: 10,
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: /schema/i }));

    const tree = screen.getByRole('tree', { name: 'JSON view' });
    expect(tree).toHaveTextContent('city');
    expect(tree).toHaveTextContent('string');
  });
});
