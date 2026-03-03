import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useParams } from 'react-router-dom';
import TemplateDetailPage from './TemplateDetailPage';
import type { EvaluationDataSource } from '../evaluation/api';
import type {
  CreateTemplateRequest,
  ForkTemplateRequest,
  PublishVersionRequest,
  TemplateDefinition,
} from '../evaluation/types';

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => jest.fn(),
    useParams: jest.fn(),
  };
});

function makeTemplate(templateID: string, versions: string[]): TemplateDefinition {
  return {
    tenant_id: 'tenant-1',
    template_id: templateID,
    scope: 'tenant',
    kind: 'heuristic',
    description: '',
    latest_version: versions[versions.length - 1],
    config: {},
    output_keys: [{ key: 'score', type: 'number' }],
    versions: versions.map((version) => ({
      version,
      changelog: '',
      created_at: '2026-03-03T00:00:00Z',
    })),
    created_at: '2026-03-03T00:00:00Z',
    updated_at: '2026-03-03T00:00:00Z',
  };
}

function createDataSource(overrides?: Partial<EvaluationDataSource>): EvaluationDataSource {
  return {
    listEvaluators: jest.fn(async () => ({ items: [], next_cursor: '' })),
    createEvaluator: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    getEvaluator: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    deleteEvaluator: jest.fn(async () => {}),
    listPredefinedEvaluators: jest.fn(async () => ({ items: [], next_cursor: '' })),
    forkPredefinedEvaluator: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    listRules: jest.fn(async () => ({ items: [], next_cursor: '' })),
    createRule: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    getRule: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    updateRule: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    deleteRule: jest.fn(async () => {}),
    previewRule: jest.fn(async () => {
      throw new Error('not implemented in test');
    }),
    listJudgeProviders: jest.fn(async () => ({ providers: [] })),
    listJudgeModels: jest.fn(async () => ({ models: [] })),
    listTemplates: jest.fn(async () => ({ items: [], next_cursor: '' })),
    createTemplate: jest.fn(async (_request: CreateTemplateRequest) => {
      throw new Error('not implemented in test');
    }),
    getTemplate: jest.fn(async (templateID: string) => makeTemplate(templateID, ['2026-03-01', '2026-03-02'])),
    deleteTemplate: jest.fn(async () => {}),
    listTemplateVersions: jest.fn(async () => ({ items: [] })),
    publishVersion: jest.fn(async (_templateID: string, _request: PublishVersionRequest) => {
      throw new Error('not implemented in test');
    }),
    getTemplateVersion: jest.fn(async (templateID: string, version: string) => ({
      tenant_id: 'tenant-1',
      template_id: templateID,
      version,
      config: {},
      output_keys: [{ key: 'score', type: 'number' }],
      changelog: '',
      created_at: '2026-03-03T00:00:00Z',
    })),
    forkTemplate: jest.fn(async (_templateID: string, request: ForkTemplateRequest) => ({
      evaluator_id: request.evaluator_id,
      version: '2026-03-03',
      kind: 'heuristic',
      config: request.config ?? {},
      output_keys: [{ key: 'score', type: 'number' }],
      is_predefined: false,
      created_at: '2026-03-03T00:00:00Z',
      updated_at: '2026-03-03T00:00:00Z',
    })),
    ...overrides,
  };
}

describe('TemplateDetailPage', () => {
  it('clears selected compare versions when templateID changes', async () => {
    const mockedUseParams = useParams as jest.MockedFunction<typeof useParams>;
    mockedUseParams.mockReturnValue({ templateID: 'template-1' });

    const getTemplate = jest
      .fn<ReturnType<EvaluationDataSource['getTemplate']>, Parameters<EvaluationDataSource['getTemplate']>>()
      .mockImplementation(async (templateID: string) =>
        templateID === 'template-1'
          ? makeTemplate('template-1', ['2026-03-01', '2026-03-02'])
          : makeTemplate('template-2', ['2026-04-01', '2026-04-02'])
      );
    const getTemplateVersion = jest
      .fn<
        ReturnType<EvaluationDataSource['getTemplateVersion']>,
        Parameters<EvaluationDataSource['getTemplateVersion']>
      >()
      .mockImplementation(async (templateID: string, version: string) => ({
        tenant_id: 'tenant-1',
        template_id: templateID,
        version,
        config: {},
        output_keys: [{ key: 'score', type: 'number' }],
        changelog: '',
        created_at: '2026-03-03T00:00:00Z',
      }));
    const dataSource = createDataSource({ getTemplate, getTemplateVersion });

    const { rerender } = render(<TemplateDetailPage dataSource={dataSource} />);

    await waitFor(() => expect(getTemplate).toHaveBeenCalledWith('template-1'));
    const firstTemplateCheckboxes = await screen.findAllByRole('checkbox');
    fireEvent.click(firstTemplateCheckboxes[0]);
    fireEvent.click(firstTemplateCheckboxes[1]);

    await waitFor(() =>
      expect(getTemplateVersion).toHaveBeenCalledWith('template-1', expect.stringMatching(/^2026-03-0[12]$/))
    );
    const compareCallsBeforeNavigation = getTemplateVersion.mock.calls.length;

    mockedUseParams.mockReturnValue({ templateID: 'template-2' });
    rerender(<TemplateDetailPage dataSource={dataSource} />);

    await waitFor(() => expect(getTemplate).toHaveBeenCalledWith('template-2'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(getTemplateVersion).toHaveBeenCalledTimes(compareCallsBeforeNavigation);
    expect(screen.queryByText('Failed to load versions for compare')).not.toBeInTheDocument();
  });
});
