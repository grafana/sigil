import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConversationsDataSource } from '../../conversation/api';
import type { EvaluationDataSource } from '../../evaluation/api';
import EvalTestPanel from './EvalTestPanel';

jest.mock('./GenerationPicker', () => ({
  __esModule: true,
  default: ({ onSelect }: { onSelect: (id: string, hints?: { conversation_id?: string }) => void }) => (
    <button type="button" onClick={() => onSelect('gen-1', { conversation_id: 'conv-1' })}>
      Pick generation
    </button>
  ),
}));

jest.mock('../chat/ChatMessage', () => ({
  __esModule: true,
  default: () => <div>chat message</div>,
}));

jest.mock('./TestResultDisplay', () => ({
  __esModule: true,
  default: () => <div>test result</div>,
}));

describe('EvalTestPanel', () => {
  it('requires provider and model together for llm_judge overrides', async () => {
    const dataSource = {
      listJudgeProviders: jest.fn(async () => ({
        providers: [{ id: 'openai', name: 'OpenAI', type: 'openai' }],
      })),
      listJudgeModels: jest.fn(async () => ({ models: [] })),
      testEval: jest.fn(),
    } as unknown as EvaluationDataSource;
    const conversationsDataSource = {
      getGeneration: jest.fn(async () => ({
        generation_id: 'gen-1',
        conversation_id: 'conv-1',
        input: [],
        output: [],
        model: { provider: 'openai', name: 'gpt-4o' },
        created_at: '2026-03-09T12:00:00Z',
      })),
    } as unknown as ConversationsDataSource;

    render(
      <EvalTestPanel
        kind="llm_judge"
        config={{ provider: 'openai', model: 'gpt-4o-mini', max_tokens: 128, temperature: 0 }}
        outputKeys={[{ key: 'score', type: 'number' }]}
        dataSource={dataSource}
        conversationsDataSource={conversationsDataSource}
      />
    );

    await waitFor(() => expect(dataSource.listJudgeProviders).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getAllByText('Default')[0]);
    fireEvent.click(await screen.findByText('OpenAI'));

    expect(screen.getByText('Choose both provider and model, or leave both blank')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pick generation' }));

    await waitFor(() => expect(conversationsDataSource.getGeneration).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Run test' })).toBeDisabled();
    expect(dataSource.testEval).not.toHaveBeenCalled();
  });

  it('allows a fully-qualified model override without a provider', async () => {
    const dataSource = {
      listJudgeProviders: jest.fn(async () => ({
        providers: [{ id: 'openai', name: 'OpenAI', type: 'openai' }],
      })),
      listJudgeModels: jest.fn(async () => ({ models: [] })),
      testEval: jest.fn(async () => ({ score: 0.8 })),
    } as unknown as EvaluationDataSource;
    const conversationsDataSource = {
      getGeneration: jest.fn(async () => ({
        generation_id: 'gen-1',
        conversation_id: 'conv-1',
        input: [],
        output: [],
        model: { provider: 'openai', name: 'gpt-4o' },
        created_at: '2026-03-09T12:00:00Z',
      })),
    } as unknown as ConversationsDataSource;

    render(
      <EvalTestPanel
        kind="llm_judge"
        config={{ max_tokens: 128, temperature: 0 }}
        outputKeys={[{ key: 'score', type: 'number' }]}
        dataSource={dataSource}
        conversationsDataSource={conversationsDataSource}
      />
    );

    await waitFor(() => expect(dataSource.listJudgeProviders).toHaveBeenCalled());

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'openai/gpt-4o-mini' } });
    fireEvent.click(screen.getByText('openai/gpt-4o-mini'));
    expect(
      screen.queryByText('Choose both provider and model, or use a fully-qualified model like provider/model')
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pick generation' }));
    await waitFor(() => expect(conversationsDataSource.getGeneration).toHaveBeenCalled());

    const runButton = screen.getByRole('button', { name: 'Run test' });
    expect(runButton).not.toBeDisabled();
    fireEvent.click(runButton);

    await waitFor(() =>
      expect(dataSource.testEval).toHaveBeenCalledWith({
        kind: 'llm_judge',
        config: { max_tokens: 128, temperature: 0, model: 'openai/gpt-4o-mini' },
        output_keys: [{ key: 'score', type: 'number' }],
        generation_id: 'gen-1',
      })
    );
  });
});
