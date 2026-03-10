import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { GenerationDetail } from '../../generation/types';
import type { ConversationSpan } from '../../conversation/types';
import type { FlowNode } from './types';
import GenerationView from './GenerationView';

describe('GenerationView', () => {
  it('labels tool-result messages as tool results', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-tool-result',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      input: [
        {
          role: 'MESSAGE_ROLE_TOOL',
          parts: [{ tool_result: { tool_call_id: 'tc-1', name: 'search', content: '{"hits":3}' } }],
        },
      ],
    };
    const node: FlowNode = {
      id: 'node-tool-result',
      kind: 'generation',
      label: 'generation',
      durationMs: 125,
      startMs: 0,
      status: 'success',
      generation,
      children: [],
    };

    render(<GenerationView node={node} allGenerations={[generation]} flowNodes={[]} onClose={jest.fn()} />);

    expect(screen.getByText('Tool Result')).toBeInTheDocument();
  });

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

    render(<GenerationView node={node} allGenerations={[generation]} flowNodes={[]} onClose={jest.fn()} />);

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

    render(<GenerationView node={node} allGenerations={[generation]} flowNodes={[]} onClose={jest.fn()} />);

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

    const { container } = render(
      <GenerationView node={node} allGenerations={[generation]} flowNodes={[]} onClose={jest.fn()} />
    );

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

    render(<GenerationView node={node} allGenerations={[generation]} flowNodes={[]} onClose={jest.fn()} />);

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
        flowNodes={[]}
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

    render(<GenerationView node={node} allGenerations={[generation]} flowNodes={[]} onClose={jest.fn()} />);

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
        flowNodes={[]}
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

  it('reveals hidden turns and collapses them back', () => {
    const previous: GenerationDetail = {
      generation_id: 'gen-ctx-1',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T09:58:00Z',
      input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'first question' }] }],
      output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'first answer' }] }],
    };
    const current: GenerationDetail = {
      generation_id: 'gen-ctx-2',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      input: [
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'first question' }] },
        { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'first answer' }] },
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'second question' }] },
      ],
      output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'second answer' }] }],
    };
    const node: FlowNode = {
      id: 'node-ctx',
      kind: 'generation',
      label: 'generation',
      durationMs: 200,
      startMs: 0,
      status: 'success',
      generation: current,
      children: [],
    };

    render(<GenerationView node={node} allGenerations={[previous, current]} flowNodes={[]} onClose={jest.fn()} />);

    // Only the current prompt turn is visible initially
    expect(screen.getByText('second question')).toBeInTheDocument();
    expect(screen.queryByText('first question')).not.toBeInTheDocument();
    expect(screen.queryByText('first answer')).not.toBeInTheDocument();
    expect(screen.getByText('Current prompt')).toBeInTheDocument();
    expect(screen.getByText('Turn 2 of 2')).toBeInTheDocument();

    // "Load more" shows the count of hidden turns
    const loadMore = screen.getByText(/Load.*turn/);
    expect(loadMore).toHaveTextContent('Load 1 more turn');
    expect(screen.queryByText('Collapse')).not.toBeInTheDocument();

    // Clicking reveals the full previous turn (both user + assistant)
    fireEvent.click(loadMore);
    expect(screen.getByText('first question')).toBeInTheDocument();
    expect(screen.getByText('first answer')).toBeInTheDocument();
    expect(screen.queryByText(/Load.*turn/)).not.toBeInTheDocument();
    expect(screen.getByText('Collapse')).toBeInTheDocument();
    // Turn group separator labels the revealed turn
    expect(screen.getByText('Turn 1 of 2')).toBeInTheDocument();
    // "Current prompt" separator divides history from current
    expect(screen.getByText('Current prompt')).toBeInTheDocument();

    // Collapse hides all context turns again
    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.queryByText('first question')).not.toBeInTheDocument();
    expect(screen.queryByText('first answer')).not.toBeInTheDocument();
    expect(screen.getByText('second question')).toBeInTheDocument();
    expect(screen.getByText(/Load.*turn/)).toHaveTextContent('Load 1 more turn');
  });

  it('reveals cumulative 3-turn history one turn at a time with separators', () => {
    const gen1: GenerationDetail = {
      generation_id: 'gen-c1',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T09:58:00Z',
      input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'q1' }] }],
      output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'a1' }] }],
    };
    const gen2: GenerationDetail = {
      generation_id: 'gen-c2',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T09:59:00Z',
      input: [
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'q1' }] },
        { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'a1' }] },
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'q2' }] },
      ],
      output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'a2' }] }],
    };
    const gen3: GenerationDetail = {
      generation_id: 'gen-c3',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      input: [
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'q1' }] },
        { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'a1' }] },
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'q2' }] },
        { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'a2' }] },
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'q3' }] },
      ],
      output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'a3' }] }],
    };
    const node: FlowNode = {
      id: 'node-c3',
      kind: 'generation',
      label: 'generation',
      durationMs: 200,
      startMs: 0,
      status: 'success',
      generation: gen3,
      children: [],
    };

    render(<GenerationView node={node} allGenerations={[gen1, gen2, gen3]} flowNodes={[]} onClose={jest.fn()} />);

    // Only the current prompt turn (turn 3) visible initially
    expect(screen.getByText('q3')).toBeInTheDocument();
    expect(screen.queryByText('q1')).not.toBeInTheDocument();
    expect(screen.queryByText('q2')).not.toBeInTheDocument();
    expect(screen.getByText('Turn 3 of 3')).toBeInTheDocument();

    const loadMore = screen.getByText(/Load more/);
    expect(loadMore).toHaveTextContent('Load more (2 turns)');

    // First click reveals turn 2 (closest to current)
    fireEvent.click(loadMore);
    expect(screen.getByText('q2')).toBeInTheDocument();
    expect(screen.getByText('a2')).toBeInTheDocument();
    expect(screen.queryByText('q1')).not.toBeInTheDocument();
    // Turn group separator labels the revealed turn
    expect(screen.getByText('Turn 2 of 3')).toBeInTheDocument();
    expect(screen.getByText(/Load.*turn/)).toHaveTextContent('Load 1 more turn');

    // Second click reveals turn 1
    fireEvent.click(screen.getByText(/Load.*turn/));
    expect(screen.getByText('q1')).toBeInTheDocument();
    expect(screen.getByText('a1')).toBeInTheDocument();
    // Both turn separators visible
    expect(screen.getByText('Turn 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Turn 2 of 3')).toBeInTheDocument();
    expect(screen.queryByText(/Load.*turn/)).not.toBeInTheDocument();

    // Current prompt separator visible between history and current
    expect(screen.getByText('Current prompt')).toBeInTheDocument();

    // Collapse hides all history
    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.queryByText('q1')).not.toBeInTheDocument();
    expect(screen.queryByText('q2')).not.toBeInTheDocument();
    expect(screen.getByText('q3')).toBeInTheDocument();
  });

  it('shows only rewritten input tail when the latest prompt edits prior history', () => {
    const previous: GenerationDetail = {
      generation_id: 'gen-prev',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T09:59:00Z',
      input: [
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'original question' }] },
        { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'original answer' }] },
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'old follow-up' }] },
      ],
      output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'old follow-up answer' }] }],
    };
    const rewritten: GenerationDetail = {
      generation_id: 'gen-rewritten',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      input: [
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'original question' }] },
        { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'original answer' }] },
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'rewritten follow-up' }] },
      ],
      output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'rewritten answer' }] }],
    };
    const node: FlowNode = {
      id: 'node-rewritten',
      kind: 'generation',
      label: 'generation',
      durationMs: 250,
      startMs: 0,
      status: 'success',
      generation: rewritten,
      children: [],
    };

    render(<GenerationView node={node} allGenerations={[previous, rewritten]} flowNodes={[]} onClose={jest.fn()} />);

    expect(screen.getByText('rewritten follow-up')).toBeInTheDocument();
    expect(screen.getByText('rewritten answer')).toBeInTheDocument();
    expect(screen.queryByText('old follow-up')).not.toBeInTheDocument();
    expect(screen.queryByText('old follow-up answer')).not.toBeInTheDocument();
    expect(screen.queryByText('original question')).not.toBeInTheDocument();
    expect(screen.queryByText('original answer')).not.toBeInTheDocument();
  });

  it('shows current turn and hides earlier turns for a single multi-turn generation', () => {
    const generation: GenerationDetail = {
      generation_id: 'gen-multi-turn',
      conversation_id: 'conv-1',
      created_at: '2026-03-04T10:00:00Z',
      input: [
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'first question' }] },
        { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'first answer' }] },
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'second question' }] },
      ],
      output: [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'second answer' }] }],
    };
    const node: FlowNode = {
      id: 'node-multi-turn',
      kind: 'generation',
      label: 'generation',
      durationMs: 200,
      startMs: 0,
      status: 'success',
      generation,
      children: [],
    };

    render(<GenerationView node={node} allGenerations={[generation]} flowNodes={[]} onClose={jest.fn()} />);

    // Only current prompt (turn 2) is visible; turn 1 is hidden in history
    expect(screen.getByText('second question')).toBeInTheDocument();
    expect(screen.queryByText('first question')).not.toBeInTheDocument();
    expect(screen.getByText('Current prompt')).toBeInTheDocument();
    expect(screen.getByText('Turn 2 of 2')).toBeInTheDocument();
    expect(screen.getByText(/Load.*turn/)).toHaveTextContent('Load 1 more turn');

    // Reveal turn 1
    fireEvent.click(screen.getByText(/Load.*turn/));
    expect(screen.getByText('first question')).toBeInTheDocument();
    expect(screen.getByText('first answer')).toBeInTheDocument();
    expect(screen.getByText('Turn 1 of 2')).toBeInTheDocument();
  });
});
