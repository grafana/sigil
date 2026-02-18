import React from 'react';
import { render, screen } from '@testing-library/react';
import GenerationHeader from './GenerationHeader';
import type { GenerationDetail } from '../../conversation/types';

describe('GenerationHeader', () => {
  it('renders model badge with provider/name', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      model: { provider: 'openai', name: 'gpt-4o' },
    };
    render(<GenerationHeader generation={generation} />);
    expect(screen.getByText('openai/gpt-4o')).toBeInTheDocument();
  });

  it('renders agent badge when present', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      agent_name: 'triage-bot',
    };
    render(<GenerationHeader generation={generation} />);
    expect(screen.getByText('triage-bot')).toBeInTheDocument();
  });

  it('hides agent badge when absent', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      model: { provider: 'openai', name: 'gpt-4o' },
    };
    render(<GenerationHeader generation={generation} />);
    expect(screen.queryByText('triage-bot')).not.toBeInTheDocument();
  });

  it('renders mode badge', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      mode: 'STREAM',
    };
    render(<GenerationHeader generation={generation} />);
    expect(screen.getByText('STREAM')).toBeInTheDocument();
  });

  it('renders token usage text', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      usage: { input_tokens: 120, output_tokens: 42, total_tokens: 162 },
    };
    render(<GenerationHeader generation={generation} />);
    expect(screen.getByText('120 in / 42 out')).toBeInTheDocument();
  });

  it('renders trace link when trace_id is present', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      trace_id: 'abc-123',
    };
    render(<GenerationHeader generation={generation} />);
    expect(screen.getByLabelText('view trace')).toBeInTheDocument();
  });

  it('hides trace link when trace_id is absent', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
    };
    render(<GenerationHeader generation={generation} />);
    expect(screen.queryByLabelText('view trace')).not.toBeInTheDocument();
  });
});
