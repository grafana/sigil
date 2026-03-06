import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { GenerationDetail } from '../../generation/types';
import type { ConversationSpan } from '../../conversation/types';
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

  it('keeps usage and duration visible when there is no span attribute section', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-orphan',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
      usage: {
        input_tokens: 3,
        output_tokens: 215,
      },
      input: [
        {
          role: 'MESSAGE_ROLE_USER',
          parts: [{ text: 'hello' }],
        },
      ],
    };
    const node: FlowNode = {
      id: 'node-orphan',
      kind: 'generation',
      label: 'generation',
      durationMs: 28730,
      startMs: 0,
      status: 'success',
      generation,
      children: [],
    };

    render(<GenerationView node={node} allGenerations={[generation]} onClose={jest.fn()} />);

    expect(screen.getByText(/↓3\s+↑215/)).toBeInTheDocument();
    expect(screen.getAllByText('claude-sonnet-4-6').length).toBeGreaterThan(1);
    expect(screen.getByText('28.73s')).toBeInTheDocument();
  });

  it('hides the system prompt and shows resource and span attributes collapsed at the top', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-2',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      system_prompt: 'Keep this hidden',
      usage: {
        input_tokens: 1725,
        output_tokens: 429,
      },
      input: [
        {
          role: 'MESSAGE_ROLE_USER',
          parts: [{ text: 'hello' }],
        },
      ],
    };
    const span: ConversationSpan = {
      traceID: 'trace-1',
      spanID: 'span-1',
      parentSpanID: '',
      name: 'generateText',
      kind: 'INTERNAL',
      serviceName: 'sigil',
      startTimeUnixNano: BigInt(0),
      endTimeUnixNano: BigInt(1),
      durationNano: BigInt(1),
      attributes: new Map([
        ['span.kind', { stringValue: 'llm' }],
        ['gen_ai.operation.name', { stringValue: 'streamText' }],
        ['user.id', { stringValue: 'jess@example.com' }],
      ]),
      resourceAttributes: new Map([
        ['service.name', { stringValue: 'assistant-api' }],
        ['deployment.environment', { stringValue: 'prod' }],
      ]),
      generation: generation,
      children: [],
    };
    const node: FlowNode = {
      id: 'node-2',
      kind: 'generation',
      label: 'generation',
      durationMs: 125,
      startMs: 0,
      status: 'success',
      generation,
      span,
      children: [],
    };

    const { container } = render(<GenerationView node={node} allGenerations={[generation]} onClose={jest.fn()} />);

    expect(screen.queryByText('System Prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('Keep this hidden')).not.toBeInTheDocument();

    const attributesHeader = screen.getByText('Attributes');
    const inputHeader = screen.getByText('Input');
    expect(container.textContent?.indexOf('Attributes')).toBeLessThan(container.textContent?.indexOf('Input') ?? 0);
    expect(attributesHeader).toBeInTheDocument();
    expect(inputHeader).toBeInTheDocument();
    expect(screen.queryByText('assistant-api')).not.toBeInTheDocument();
    expect(screen.queryByText('llm')).not.toBeInTheDocument();
    expect(screen.queryByText('jess@example.com')).not.toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('↓1,725') && content.includes('↑429'))).toBeInTheDocument();
    expect(screen.queryByText('streamText')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open trace drawer for span .* \(T\)/ })).toBeInTheDocument();
    expect(screen.getByText('T')).toBeInTheDocument();

    fireEvent.click(attributesHeader);

    expect(screen.getByRole('tab', { name: /Gen AI \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Resource \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Attributes \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText('gen_ai.operation.name')).toBeInTheDocument();
    expect(screen.getByText('streamText')).toBeInTheDocument();
    expect(screen.queryByText('user.id')).not.toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('↓1,725') && content.includes('↑429'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Resource \(2\)/ }));

    expect(screen.getByText('service.name')).toBeInTheDocument();
    expect(screen.getByText('assistant-api')).toBeInTheDocument();
    expect(screen.getByText('deployment.environment')).toBeInTheDocument();
    expect(screen.getByText('prod')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Attributes \(1\)/ }));

    expect(screen.getByText('span.kind')).toBeInTheDocument();
    expect(screen.getByText('llm')).toBeInTheDocument();
  });

  it('keeps the system prompt hidden by default but available in the agent context tooltip', async () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-3',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      system_prompt: 'visible only in tooltip',
      agent_name: 'fe-grafana-assistant',
      model: {
        provider: 'bedrock',
        name: 'claude-sonnet',
      },
      input: [
        {
          role: 'MESSAGE_ROLE_USER',
          parts: [{ text: 'hello' }],
        },
      ],
    };
    const node: FlowNode = {
      id: 'node-3',
      kind: 'generation',
      label: 'generation',
      durationMs: 125,
      startMs: 0,
      status: 'success',
      generation,
      children: [],
    };

    render(<GenerationView node={node} allGenerations={[generation]} onClose={jest.fn()} />);

    expect(screen.queryByText('visible only in tooltip')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Agent context'));

    expect(await screen.findByText('System Prompt')).toBeInTheDocument();
    expect(screen.getByText('visible only in tooltip')).toBeInTheDocument();
  });

  it('renders an agent detail button between the agent label and step index', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-4',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      agent_name: 'fe-grafana-assistant',
      agent_version: 'v1',
      agent_effective_version: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      input: [
        {
          role: 'MESSAGE_ROLE_USER',
          parts: [{ text: 'hello' }],
        },
      ],
    };
    const node: FlowNode = {
      id: 'node-4',
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
        allGenerations={[generation, { ...generation, generation_id: 'gen-5' }]}
        onClose={jest.fn()}
      />
    );

    const link = screen.getByRole('link', {
      name: 'Open agent page: fe-grafana-assistant (sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)',
    });
    expect(link).toHaveAttribute(
      'href',
      '/a/grafana-sigil-app/agents/name/fe-grafana-assistant?version=sha256%3Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    expect(screen.getByText('fe-grafana-assistant')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('deduplicates AI attribute pills when same key appears in both resource and span attributes', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-dup',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'hi' }] }],
    };
    const span: ConversationSpan = {
      traceID: 'trace-dup',
      spanID: 'span-dup',
      parentSpanID: '',
      name: 'generateText',
      kind: 'INTERNAL',
      serviceName: 'sigil',
      startTimeUnixNano: BigInt(0),
      endTimeUnixNano: BigInt(1),
      durationNano: BigInt(1),
      attributes: new Map([
        ['gen_ai.system', { stringValue: 'openai' }],
        ['sigil.conversation.id', { stringValue: 'span-conv-id' }],
      ]),
      resourceAttributes: new Map([
        ['gen_ai.system', { stringValue: 'azure' }],
        ['sigil.conversation.id', { stringValue: 'resource-conv-id' }],
      ]),
      generation,
      children: [],
    };
    const node: FlowNode = {
      id: 'node-dup',
      kind: 'generation',
      label: 'generation',
      durationMs: 50,
      startMs: 0,
      status: 'success',
      generation,
      span,
      children: [],
    };

    render(<GenerationView node={node} allGenerations={[generation]} onClose={jest.fn()} />);

    // Header count should reflect deduplicated total (2 unique AI keys), not raw sum (4)
    expect(screen.getByText('(2)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Attributes'));

    const pills = screen.getAllByText('gen_ai.system');
    expect(pills).toHaveLength(1);
    expect(screen.getByText('openai')).toBeInTheDocument();
    expect(screen.queryByText('azure')).not.toBeInTheDocument();

    const sigilPills = screen.getAllByText('sigil.conversation.id');
    expect(sigilPills).toHaveLength(1);
    expect(screen.getByText('span-conv-id')).toBeInTheDocument();
    expect(screen.queryByText('resource-conv-id')).not.toBeInTheDocument();
  });

  it('does not use agent_id as an effective version candidate', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-no-agent-id',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      agent_name: 'assistant',
      agent_id: 'assistant',
      agent_effective_version: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'hi' }] }],
    };
    const node: FlowNode = {
      id: 'node-no-agent-id',
      kind: 'generation',
      label: 'generation',
      durationMs: 100,
      startMs: 0,
      status: 'success',
      generation,
      children: [],
    };

    render(
      <GenerationView
        node={node}
        allGenerations={[generation, { ...generation, generation_id: 'gen-other' }]}
        onClose={jest.fn()}
      />
    );

    const link = screen.getByRole('link', {
      name: /Open agent page: assistant/,
    });
    expect(link.getAttribute('href')).toContain(
      'version=sha256%3Abbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    );
  });
});
