import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('opens agent context drawer payload with hash-style version link', () => {
    const onOpenAgentContext = jest.fn();
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      agent_name: 'assistant',
      agent_effective_version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      model: {
        provider: 'openai',
        name: 'gpt-4.1',
      },
      system_prompt: 'You are in assistant mode.',
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

    render(
      <GenerationView
        node={node}
        allGenerations={[generation]}
        onClose={jest.fn()}
        onOpenAgentContext={onOpenAgentContext}
      />
    );

    fireEvent.click(screen.getByLabelText('Agent context'));

    expect(onOpenAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'assistant · gpt-4.1',
        agentDetailUrl:
          '/a/grafana-sigil-app/agents/name/assistant?version=sha256%3Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      })
    );
  });

  it('opens drawer payload even when only agent link metadata is present', () => {
    const onOpenAgentContext = jest.fn();
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      agent_name: 'assistant',
      agent_effective_version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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

    render(
      <GenerationView
        node={node}
        allGenerations={[generation]}
        onClose={jest.fn()}
        onOpenAgentContext={onOpenAgentContext}
      />
    );

    fireEvent.click(screen.getByLabelText('Agent context'));

    expect(onOpenAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'assistant',
        agentDetailUrl:
          '/a/grafana-sigil-app/agents/name/assistant?version=sha256%3Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      })
    );
  });

  it('does not use declared agent_version as agent detail version query parameter', () => {
    const onOpenAgentContext = jest.fn();
    const generation: GenerationDetail = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      agent_name: 'assistant',
      agent_version: '1.2.3',
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

    render(
      <GenerationView
        node={node}
        allGenerations={[generation]}
        onClose={jest.fn()}
        onOpenAgentContext={onOpenAgentContext}
      />
    );

    fireEvent.click(screen.getByLabelText('Agent context'));

    expect(onOpenAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'assistant',
        agentDetailUrl: '/a/grafana-sigil-app/agents/name/assistant',
      })
    );
  });
});
