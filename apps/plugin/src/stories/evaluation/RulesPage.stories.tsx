import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import RulesPage from '../../pages/RulesPage';
import { EvalRulesDataProvider } from '../../contexts/EvalRulesDataContext';
import { type EvaluationDataSource } from '../../evaluation/api';
import type {
  CreateEvaluatorRequest,
  CreateRuleRequest,
  Evaluator,
  ForkEvaluatorRequest,
  JudgeModelListResponse,
  JudgeProviderListResponse,
  Rule,
  RulePreviewRequest,
  RulePreviewResponse,
  UpdateRuleRequest,
} from '../../evaluation/types';

const mockRule1: Rule = {
  rule_id: 'online.helpfulness.user_visible',
  enabled: true,
  selector: 'user_visible_turn',
  match: { agent_name: ['assistant-*'], mode: ['SYNC'] },
  sample_rate: 0.1,
  evaluator_ids: ['prod.helpfulness.v1', 'prod.not_empty'],
  created_at: '2026-02-18T00:00:00Z',
  updated_at: '2026-02-18T00:00:00Z',
};

const mockRule2: Rule = {
  rule_id: 'online.safety.tool_calls',
  enabled: false,
  selector: 'tool_call_steps',
  match: { agent_name: ['assistant-*'] },
  sample_rate: 1,
  evaluator_ids: ['prod.safety.v1'],
  created_at: '2026-02-18T00:00:00Z',
  updated_at: '2026-02-18T00:00:00Z',
};

const mockEvaluators: Evaluator[] = [
  {
    evaluator_id: 'prod.helpfulness.v1',
    version: '2026-02-17',
    kind: 'llm_judge',
    config: {},
    output_keys: [{ key: 'helpfulness', type: 'number' }],
    is_predefined: false,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
  {
    evaluator_id: 'prod.not_empty',
    version: '2026-02-17',
    kind: 'heuristic',
    config: {},
    output_keys: [{ key: 'not_empty', type: 'bool' }],
    is_predefined: false,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
  {
    evaluator_id: 'prod.safety.v1',
    version: '2026-02-17',
    kind: 'llm_judge',
    config: {},
    output_keys: [{ key: 'safety', type: 'number' }],
    is_predefined: false,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
];

const mockDataSource: EvaluationDataSource = {
  listRules: async () => ({ items: [mockRule1, mockRule2], next_cursor: '' }),
  listEvaluators: async () => ({ items: mockEvaluators, next_cursor: '' }),
  listPredefinedEvaluators: async () => ({ items: [], next_cursor: '' }),
  createEvaluator: async (_req: CreateEvaluatorRequest) => mockEvaluators[0],
  getEvaluator: async (id: string) => mockEvaluators.find((e) => e.evaluator_id === id) ?? mockEvaluators[0],
  deleteEvaluator: async () => {},
  forkPredefinedEvaluator: async (_templateID: string, _req: ForkEvaluatorRequest) => mockEvaluators[0],
  createRule: async (_req: CreateRuleRequest) => mockRule1,
  getRule: async (id: string) => (id === mockRule1.rule_id ? mockRule1 : mockRule2),
  updateRule: async (id: string, req: UpdateRuleRequest) => {
    const rule = id === mockRule1.rule_id ? mockRule1 : mockRule2;
    return { ...rule, enabled: req.enabled };
  },
  deleteRule: async () => {},
  previewRule: async (_req: RulePreviewRequest): Promise<RulePreviewResponse> => ({
    window_hours: 24,
    total_generations: 0,
    matching_generations: 0,
    sampled_generations: 0,
    samples: [],
  }),
  listJudgeProviders: async (): Promise<JudgeProviderListResponse> => ({ providers: [] }),
  listJudgeModels: async (): Promise<JudgeModelListResponse> => ({ models: [] }),
  testEval: async () => ({ generation_id: '', conversation_id: '', scores: [], execution_time_ms: 0 }),
  listTemplates: async () => ({ items: [], next_cursor: '' }),
  createTemplate: async () => ({
    tenant_id: '',
    template_id: '',
    scope: 'tenant' as const,
    kind: 'llm_judge' as const,
    description: '',
    latest_version: '',
    versions: [],
    created_at: '',
    updated_at: '',
  }),
  getTemplate: async () => ({
    tenant_id: '',
    template_id: '',
    scope: 'tenant' as const,
    kind: 'llm_judge' as const,
    description: '',
    latest_version: '',
    versions: [],
    created_at: '',
    updated_at: '',
  }),
  deleteTemplate: async () => {},
  listTemplateVersions: async () => ({ items: [] }),
  publishVersion: async () => ({
    tenant_id: '',
    template_id: '',
    version: '',
    config: {},
    output_keys: [],
    changelog: '',
    created_at: '',
  }),
  getTemplateVersion: async () => ({
    tenant_id: '',
    template_id: '',
    version: '',
    config: {},
    output_keys: [],
    changelog: '',
    created_at: '',
  }),
  forkTemplate: async () => mockEvaluators[0],
  listSavedConversations: async () => ({ items: [], next_cursor: '' }),
  saveConversation: async () => ({}) as never,
  getSavedConversation: async () => ({}) as never,
  deleteSavedConversation: async () => {},
  createManualConversation: async () => ({}) as never,
};

const meta = {
  title: 'Sigil/Evaluation/RulesPage',
  component: RulesPage,
  decorators: [
    (Story: React.ComponentType, context: { args: { dataSource?: EvaluationDataSource } }) => (
      <MemoryRouter>
        <EvalRulesDataProvider dataSource={context.args.dataSource ?? mockDataSource}>
          <Story />
        </EvalRulesDataProvider>
      </MemoryRouter>
    ),
  ],
};

export default meta;

export const Default = {
  args: {
    dataSource: mockDataSource,
  },
};

export const Empty = {
  args: {
    dataSource: {
      ...mockDataSource,
      listRules: async () => ({ items: [], next_cursor: '' }),
    },
  },
};
