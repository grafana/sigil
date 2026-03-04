import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RuleDetailPage from '../../pages/RuleDetailPage';
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

const mockRule: Rule = {
  rule_id: 'online.helpfulness.user_visible',
  enabled: true,
  selector: 'user_visible_turn',
  match: { agent_name: ['assistant-*'], mode: ['SYNC'] },
  sample_rate: 0.1,
  evaluator_ids: ['prod.helpfulness.v1', 'prod.not_empty'],
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
];

const mockPreview: RulePreviewResponse = {
  window_hours: 24,
  total_generations: 1250,
  matching_generations: 312,
  sampled_generations: 31,
  samples: [
    {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      agent_name: 'assistant-main',
      model: 'gpt-4o',
      created_at: '2026-03-02T10:00:00Z',
      input_preview: 'User asked about...',
    },
  ],
};

const mockDataSource: EvaluationDataSource = {
  listRules: async () => ({ items: [mockRule], next_cursor: '' }),
  listEvaluators: async () => ({ items: mockEvaluators, next_cursor: '' }),
  listPredefinedEvaluators: async () => ({ items: [], next_cursor: '' }),
  createEvaluator: async (_req: CreateEvaluatorRequest) => mockEvaluators[0],
  getEvaluator: async (id: string) => mockEvaluators.find((e) => e.evaluator_id === id) ?? mockEvaluators[0],
  deleteEvaluator: async () => {},
  forkPredefinedEvaluator: async (_templateID: string, _req: ForkEvaluatorRequest) => mockEvaluators[0],
  createRule: async (req: CreateRuleRequest) => ({ ...mockRule, rule_id: req.rule_id }),
  getRule: async () => mockRule,
  updateRule: async (_id: string, req: UpdateRuleRequest) => ({ ...mockRule, enabled: req.enabled }),
  deleteRule: async () => {},
  previewRule: async (_req: RulePreviewRequest) => mockPreview,
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
};

const meta = {
  title: 'Sigil/Evaluation/RuleDetailPage',
  component: RuleDetailPage,
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export default meta;

export const CreateMode = {
  args: {
    dataSource: mockDataSource,
    ruleID: undefined,
    onNavigateBack: () => {
      console.log('Navigate back');
    },
  },
};

export const EditMode = {
  args: {
    dataSource: mockDataSource,
    ruleID: 'online.helpfulness.user_visible',
    onNavigateBack: () => {
      console.log('Navigate back');
    },
  },
};

export const EditModeWithRoute = {
  render: () => (
    <MemoryRouter initialEntries={['/evaluation/rules/online.helpfulness.user_visible']}>
      <Routes>
        <Route
          path="/evaluation/rules/:ruleID"
          element={
            <RuleDetailPage
              dataSource={mockDataSource}
              onNavigateBack={() => {
                console.log('Navigate back');
              }}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  ),
};
