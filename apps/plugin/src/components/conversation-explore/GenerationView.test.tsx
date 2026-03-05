import React from 'react';
import { render, screen, within } from '@testing-library/react';
import type { GenerationDetail } from '../../generation/types';
import type { FlowNode } from './types';
import GenerationView from './GenerationView';

describe('GenerationView', () => {
  it('renders neutral score chip when passed is null', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      latest_scores: {
        quality: {
          value: { number: 0.9 },
          evaluator_id: 'sigil.quality',
          evaluator_version: '2026-03-04',
          created_at: '2026-03-04T10:00:01Z',
          passed: null,
        },
      },
    };
    const node: FlowNode = {
      id: 'node-1',
      kind: 'generation',
      label: 'generation',
      durationMs: 125,
      startMs: 0,
      status: 'success',
      generation,
      children: [],
    };

    render(<GenerationView node={node} allGenerations={[generation]} onClose={jest.fn()} />);

    const chip = screen.getByText('sigil.quality').closest('div');
    expect(chip).not.toBeNull();
    expect(within(chip!).queryByText('✗')).not.toBeInTheDocument();
    expect(within(chip!).queryByText('✓')).not.toBeInTheDocument();
  });

  it('renders explicit in/out and cache read/write usage labels', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-usage',
      conversation_id: 'conv-usage',
      created_at: '2026-03-04T10:00:00Z',
      usage: {
        input_tokens: 3,
        output_tokens: 1934,
        cache_read_input_tokens: 51119,
        cache_write_input_tokens: 22035,
      },
    };
    const node: FlowNode = {
      id: 'node-usage',
      kind: 'generation',
      label: 'generation',
      durationMs: 200,
      startMs: 0,
      status: 'success',
      generation,
      children: [],
    };

    render(<GenerationView node={node} allGenerations={[generation]} onClose={jest.fn()} />);

    expect(screen.getByText(/in 3 \/ out 1,934/)).toBeInTheDocument();
    expect(screen.getByText(/cache read 51,119 \/ write 22,035/)).toBeInTheDocument();
  });
});
