import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EvaluatorsPage from './EvaluatorsPage';
import type { EvaluationDataSource } from '../evaluation/api';
import type {
  CreateEvaluatorRequest,
  CreateTemplateRequest,
  ForkEvaluatorRequest,
  ForkTemplateRequest,
  PublishVersionRequest,
  RulePreviewRequest,
  UpdateRuleRequest,
} from '../evaluation/types';

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    Select: ({
      options,
      value,
      onChange,
    }: {
      options: Array<{ label: string; value?: string }>;
      value?: string;
      onChange?: (v: { value?: string }) => void;
    }) => (
      <label>
        scope filter
        <select
          aria-label="scope filter"
          value={value ?? ''}
          onChange={(event) => onChange?.({ value: event.currentTarget.value })}
        >
          {options.map((option) => (
            <option key={option.value ?? 'all'} value={option.value ?? ''}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    ),
  };
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createDataSource(overrides?: Partial<EvaluationDataSource>): EvaluationDataSource {
  return {
    listEvaluators: jest.fn(async () => ({
      items: [
        {
          evaluator_id: 'tenant.eval',
          version: '2026-03-01',
          kind: 'heuristic',
          config: {},
          output_keys: [{ key: 'score', type: 'number' }],
          is_predefined: false,
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
        },
      ],
      next_cursor: '',
    })),
    createEvaluator: jest.fn(async (request: CreateEvaluatorRequest) => ({
      evaluator_id: request.evaluator_id,
      version: request.version,
      kind: request.kind,
      config: request.config,
      output_keys: request.output_keys,
      is_predefined: false,
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    })),
    getEvaluator: jest.fn(async (evaluatorID: string) => ({
      evaluator_id: evaluatorID,
      version: '2026-03-01',
      kind: 'heuristic',
      config: {},
      output_keys: [{ key: 'score', type: 'number' }],
      is_predefined: false,
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    })),
    deleteEvaluator: jest.fn(async () => {}),
    listPredefinedEvaluators: jest.fn(async () => ({ items: [], next_cursor: '' })),
    forkPredefinedEvaluator: jest.fn(async (_templateID: string, request: ForkEvaluatorRequest) => ({
      evaluator_id: request.evaluator_id,
      version: '2026-03-01',
      kind: 'llm_judge',
      config: request.config ?? {},
      output_keys: [{ key: 'score', type: 'number' }],
      is_predefined: false,
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    })),
    listRules: jest.fn(async () => ({ items: [], next_cursor: '' })),
    createRule: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    getRule: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    updateRule: jest.fn(async (_ruleID: string, _request: UpdateRuleRequest) => {
      throw new Error('not implemented in test');
    }),
    deleteRule: jest.fn(async () => {}),
    previewRule: jest.fn(async (_request: RulePreviewRequest) => ({
      window_hours: 1,
      total_generations: 0,
      matching_generations: 0,
      sampled_generations: 0,
      samples: [],
    })),
    listJudgeProviders: jest.fn(async () => ({ providers: [] })),
    listJudgeModels: jest.fn(async () => ({ models: [] })),
    listTemplates: jest.fn(async () => ({ items: [], next_cursor: '' })),
    createTemplate: jest.fn(async (_request: CreateTemplateRequest) => {
      throw new Error('not implemented in test');
    }),
    getTemplate: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    deleteTemplate: jest.fn(async () => {}),
    listTemplateVersions: jest.fn(async () => ({ items: [] })),
    publishVersion: jest.fn(async (_templateID: string, _request: PublishVersionRequest) => {
      throw new Error('not implemented in test');
    }),
    getTemplateVersion: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    forkTemplate: jest.fn(async (_templateID: string, request: ForkTemplateRequest) => ({
      evaluator_id: request.evaluator_id,
      version: '2026-03-01',
      kind: 'llm_judge',
      config: request.config ?? {},
      output_keys: [{ key: 'score', type: 'number' }],
      is_predefined: false,
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    })),
    ...overrides,
  };
}

describe('EvaluatorsPage', () => {
  it('does not refetch evaluators when scope filter changes', async () => {
    const templatesSecondRequest = createDeferred<Awaited<ReturnType<EvaluationDataSource['listTemplates']>>>();
    const listTemplates = jest
      .fn<ReturnType<EvaluationDataSource['listTemplates']>, Parameters<EvaluationDataSource['listTemplates']>>()
      .mockResolvedValueOnce({ items: [], next_cursor: '' })
      .mockImplementationOnce(async () => templatesSecondRequest.promise);
    const listEvaluators = jest.fn<
      ReturnType<EvaluationDataSource['listEvaluators']>,
      Parameters<EvaluationDataSource['listEvaluators']>
    >(async () => ({
      items: [
        {
          evaluator_id: 'tenant.eval',
          version: '2026-03-01',
          kind: 'heuristic',
          config: {},
          output_keys: [{ key: 'score', type: 'number' }],
          is_predefined: false,
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
        },
      ],
      next_cursor: '',
    }));
    const dataSource = createDataSource({ listEvaluators, listTemplates });

    render(
      <MemoryRouter>
        <EvaluatorsPage dataSource={dataSource} />
      </MemoryRouter>
    );

    await waitFor(() => expect(listEvaluators).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listTemplates).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Your Evaluators')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('scope filter'), { target: { value: 'global' } });

    await waitFor(() => expect(listTemplates).toHaveBeenCalledTimes(2));
    expect(listEvaluators).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Your Evaluators')).toBeInTheDocument();

    await act(async () => {
      templatesSecondRequest.resolve({ items: [], next_cursor: '' });
      await Promise.resolve();
    });
  });
});
