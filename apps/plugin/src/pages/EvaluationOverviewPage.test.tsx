import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
import EvaluationOverviewPage from './EvaluationOverviewPage';

const rules: Rule[] = [
  {
    rule_id: 'rule-enabled',
    enabled: true,
    selector: 'user_visible_turn',
    match: {},
    sample_rate: 1,
    evaluator_ids: ['eval.alpha', 'eval.beta'],
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  },
];

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
  {
    evaluator_id: 'eval.alpha',
    version: 'v2',
    kind: 'heuristic',
    config: {},
    output_keys: [{ key: 'alpha', type: 'bool' }],
    is_predefined: false,
    created_at: '2026-03-02T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
  },
  {
    evaluator_id: 'eval.beta',
    version: 'v1',
    kind: 'llm_judge',
    config: {},
    output_keys: [{ key: 'beta', type: 'number' }],
    is_predefined: false,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  },
  {
    evaluator_id: 'eval.beta',
    version: 'v2',
    kind: 'llm_judge',
    config: {},
    output_keys: [{ key: 'beta', type: 'number' }],
    is_predefined: false,
    created_at: '2026-03-03T00:00:00Z',
    updated_at: '2026-03-03T00:00:00Z',
  },
  {
    evaluator_id: 'eval.gamma',
    version: 'v1',
    kind: 'regex',
    config: {},
    output_keys: [{ key: 'gamma', type: 'bool' }],
    is_predefined: false,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  },
];

const predefinedEvaluators: Evaluator[] = [
  {
    evaluator_id: 'sigil.template',
    version: '1.0',
    kind: 'llm_judge',
    config: {},
    output_keys: [{ key: 'template', type: 'number' }],
    is_predefined: true,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  },
];

function createDataSource(): EvaluationDataSource {
  const listRules = jest
    .fn<Promise<{ items: Rule[]; next_cursor: string }>, [number | undefined, string | undefined]>()
    .mockImplementation(async (_limit, cursor) => {
      if (cursor === 'rules-page-2') {
        return {
          items: [
            {
              rule_id: 'rule-disabled',
              enabled: false,
              selector: 'tool_call_steps',
              match: {},
              sample_rate: 0.5,
              evaluator_ids: ['eval.gamma'],
              created_at: '2026-03-02T00:00:00Z',
              updated_at: '2026-03-02T00:00:00Z',
            },
          ],
          next_cursor: '',
        };
      }
      return {
        items: rules,
        next_cursor: 'rules-page-2',
      };
    });
  const listEvaluators = jest
    .fn<Promise<{ items: Evaluator[]; next_cursor: string }>, [number | undefined, string | undefined]>()
    .mockImplementation(async (_limit, cursor) => {
      if (cursor === 'evals-page-2') {
        return {
          items: tenantEvaluators.slice(3),
          next_cursor: '',
        };
      }
      return {
        items: tenantEvaluators.slice(0, 3),
        next_cursor: 'evals-page-2',
      };
    });

  return {
    listEvaluators,
    createEvaluator: async (request: CreateEvaluatorRequest) => tenantEvaluators[0],
    getEvaluator: async (evaluatorID: string) =>
      tenantEvaluators.find((evaluator) => evaluator.evaluator_id === evaluatorID) ?? tenantEvaluators[0],
    deleteEvaluator: async () => {},
    listPredefinedEvaluators: async () => ({ items: predefinedEvaluators, next_cursor: '' }),
    forkPredefinedEvaluator: async (_templateID: string, _request: ForkEvaluatorRequest) => tenantEvaluators[0],
    listRules,
    createRule: async (_request: CreateRuleRequest) => rules[0],
    getRule: async (_ruleID: string) => rules[0],
    updateRule: async (_ruleID: string, _request: UpdateRuleRequest) => rules[0],
    deleteRule: async () => {},
    previewRule: async (_request: RulePreviewRequest): Promise<RulePreviewResponse> => ({
      window_hours: 24,
      total_generations: 10,
      matching_generations: 5,
      sampled_generations: 5,
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
}

describe('EvaluationOverviewPage', () => {
  it('counts paginated rules and unique tenant evaluators on the summary card', async () => {
    render(
      <MemoryRouter>
        <EvalRulesDataProvider dataSource={createDataSource()}>
          <EvaluationOverviewPage />
        </EvalRulesDataProvider>
      </MemoryRouter>
    );

    const activeRulesLabel = await screen.findByText('Active rules');
    expect(activeRulesLabel.parentElement).toHaveTextContent('1');

    const disabledRulesLabel = await screen.findByText('Disabled rules');
    expect(disabledRulesLabel.parentElement).toHaveTextContent('1');

    const evaluatorsLabel = await screen.findByText('Evaluators');
    expect(evaluatorsLabel.parentElement).toHaveTextContent('3');
    expect(evaluatorsLabel.parentElement).not.toHaveTextContent('5');
  });
});
