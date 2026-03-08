import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EvaluatorsPage from './EvaluatorsPage';
import { EvalRulesDataProvider } from '../contexts/EvalRulesDataContext';
import type { EvaluationDataSource } from '../evaluation/api';
import type {
  CreateEvaluatorRequest,
  CreateManualConversationRequest,
  CreateRuleRequest,
  CreateTemplateRequest,
  EvalTestRequest,
  EvalTestResponse,
  Evaluator,
  ForkEvaluatorRequest,
  ForkTemplateRequest,
  JudgeModelListResponse,
  JudgeProviderListResponse,
  PublishVersionRequest,
  Rule,
  RulePreviewRequest,
  RulePreviewResponse,
  SaveConversationRequest,
  SavedConversation,
  SavedConversationListResponse,
  TemplateDefinition,
  TemplateListResponse,
  TemplateScope,
  TemplateVersion,
  TemplateVersionListResponse,
  UpdateRuleRequest,
} from '../evaluation/types';

jest.mock('../components/insight/PageInsightBar', () => ({
  PageInsightBar: () => null,
}));

type EvaluatorsPageTestDataSource = {
  dataSource: EvaluationDataSource;
  listRulesMock: jest.Mock<Promise<{ items: Rule[]; next_cursor: string }>, [number | undefined, string | undefined]>;
  listEvaluatorsMock: jest.Mock<
    Promise<{ items: Evaluator[]; next_cursor: string }>,
    [number | undefined, string | undefined]
  >;
  deleteEvaluatorMock: jest.Mock<Promise<void>, [string]>;
};

function createDataSource(): EvaluatorsPageTestDataSource {
  const rules: Rule[] = [];
  const tenantEvaluators: Evaluator[] = [
    {
      evaluator_id: 'eval.alpha',
      version: 'v1',
      kind: 'heuristic',
      config: {},
      output_keys: [{ key: 'alpha', type: 'bool' }],
      is_predefined: false,
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    },
  ];

  const listRules = jest
    .fn<Promise<{ items: Rule[]; next_cursor: string }>, [number | undefined, string | undefined]>()
    .mockResolvedValue({ items: rules, next_cursor: '' });
  const listEvaluators = jest
    .fn<Promise<{ items: Evaluator[]; next_cursor: string }>, [number | undefined, string | undefined]>()
    .mockResolvedValue({ items: tenantEvaluators, next_cursor: '' });
  const listPredefinedEvaluators = jest
    .fn<Promise<{ items: Evaluator[]; next_cursor: string }>, []>()
    .mockResolvedValue({ items: [], next_cursor: '' });
  const deleteEvaluator = jest.fn<Promise<void>, [string]>().mockResolvedValue();

  const dataSource: EvaluationDataSource = {
    listEvaluators,
    createEvaluator: async (_request: CreateEvaluatorRequest) => tenantEvaluators[0],
    getEvaluator: async (_evaluatorID: string) => tenantEvaluators[0],
    deleteEvaluator,
    listPredefinedEvaluators,
    forkPredefinedEvaluator: async (_templateID: string, _request: ForkEvaluatorRequest) => tenantEvaluators[0],
    listRules,
    createRule: async (_request: CreateRuleRequest) => {
      throw new Error('not implemented');
    },
    getRule: async (_ruleID: string) => {
      throw new Error('not implemented');
    },
    updateRule: async (_ruleID: string, _request: UpdateRuleRequest) => {
      throw new Error('not implemented');
    },
    deleteRule: async () => {},
    previewRule: async (_request: RulePreviewRequest): Promise<RulePreviewResponse> => ({
      window_hours: 24,
      total_generations: 0,
      matching_generations: 0,
      sampled_generations: 0,
      samples: [],
    }),
    listJudgeProviders: async (): Promise<JudgeProviderListResponse> => ({ providers: [] }),
    listJudgeModels: async (_provider: string): Promise<JudgeModelListResponse> => ({ models: [] }),
    testEval: async (_request: EvalTestRequest): Promise<EvalTestResponse> => ({
      generation_id: '',
      conversation_id: '',
      scores: [],
      execution_time_ms: 0,
    }),
    listTemplates: async (
      _scope?: TemplateScope,
      _limit?: number,
      _cursor?: string
    ): Promise<TemplateListResponse> => ({ items: [], next_cursor: '' }),
    createTemplate: async (_request: CreateTemplateRequest): Promise<TemplateDefinition> => ({
      tenant_id: '',
      template_id: '',
      scope: 'tenant',
      kind: 'heuristic',
      description: '',
      latest_version: '',
      versions: [],
      created_at: '',
      updated_at: '',
    }),
    getTemplate: async (_templateID: string): Promise<TemplateDefinition> => ({
      tenant_id: '',
      template_id: '',
      scope: 'tenant',
      kind: 'heuristic',
      description: '',
      latest_version: '',
      versions: [],
      created_at: '',
      updated_at: '',
    }),
    deleteTemplate: async (_templateID: string) => {},
    listTemplateVersions: async (_templateID: string): Promise<TemplateVersionListResponse> => ({ items: [] }),
    publishVersion: async (_templateID: string, _request: PublishVersionRequest): Promise<TemplateVersion> => ({
      tenant_id: '',
      template_id: '',
      version: '',
      config: {},
      output_keys: [],
      changelog: '',
      created_at: '',
    }),
    getTemplateVersion: async (_templateID: string, _version: string): Promise<TemplateVersion> => ({
      tenant_id: '',
      template_id: '',
      version: '',
      config: {},
      output_keys: [],
      changelog: '',
      created_at: '',
    }),
    forkTemplate: async (_templateID: string, _request: ForkTemplateRequest) => tenantEvaluators[0],
    listSavedConversations: async (
      _source?: string,
      _limit?: number,
      _cursor?: string
    ): Promise<SavedConversationListResponse> => ({ items: [], next_cursor: '' }),
    saveConversation: async (_request: SaveConversationRequest): Promise<SavedConversation> =>
      ({}) as SavedConversation,
    getSavedConversation: async (_savedID: string): Promise<SavedConversation> => ({}) as SavedConversation,
    deleteSavedConversation: async (_savedID: string) => {},
    createManualConversation: async (_request: CreateManualConversationRequest): Promise<SavedConversation> =>
      ({}) as SavedConversation,
  };

  return {
    dataSource,
    listRulesMock: listRules,
    listEvaluatorsMock: listEvaluators,
    deleteEvaluatorMock: deleteEvaluator,
  };
}

describe('EvaluatorsPage', () => {
  it('refetches shared evaluation data after deleting an evaluator', async () => {
    const { dataSource, listRulesMock, listEvaluatorsMock, deleteEvaluatorMock } = createDataSource();

    render(
      <MemoryRouter>
        <EvalRulesDataProvider dataSource={dataSource}>
          <EvaluatorsPage dataSource={dataSource} />
        </EvalRulesDataProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('eval.alpha')).toBeInTheDocument();

    const initialRuleCalls = listRulesMock.mock.calls.length;
    const initialEvaluatorCalls = listEvaluatorsMock.mock.calls.length;

    fireEvent.click(screen.getByLabelText('Delete'));
    const confirmDialog = await screen.findByRole('dialog');
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteEvaluatorMock).toHaveBeenCalledWith('eval.alpha'));
    await waitFor(() => expect(listRulesMock.mock.calls.length).toBeGreaterThan(initialRuleCalls));
    await waitFor(() => expect(listEvaluatorsMock.mock.calls.length).toBeGreaterThan(initialEvaluatorCalls));
  });
});
