import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EditEvaluatorPage from '../../pages/EditEvaluatorPage';
import { type EvaluationDataSource } from '../../evaluation/api';
import type {
  CreateEvaluatorRequest,
  Evaluator,
  ForkEvaluatorRequest,
  JudgeModelListResponse,
  JudgeProviderListResponse,
  Rule,
  RulePreviewRequest,
  RulePreviewResponse,
} from '../../evaluation/types';

const mockEvaluator: Evaluator = {
  evaluator_id: 'custom.helpfulness',
  version: '2026-03-03',
  kind: 'llm_judge',
  config: {
    system_prompt: 'You are an expert evaluator.',
    user_prompt:
      'Score from 1-10.\n\nLatest user message: {{latest_user_message}}\nAssistant response: {{assistant_response}}',
    max_tokens: 256,
    temperature: 0,
  },
  output_keys: [{ key: 'score', type: 'number' }],
  is_predefined: false,
  created_at: '2026-03-03T12:00:00Z',
  updated_at: '2026-03-03T12:00:00Z',
};

const mockEvaluatorVersions: Evaluator[] = [
  { ...mockEvaluator, version: '2026-03-03', created_at: '2026-03-03T12:00:00Z', updated_at: '2026-03-03T12:00:00Z' },
  {
    ...mockEvaluator,
    version: '2026-03-02',
    config: { ...mockEvaluator.config, temperature: 0.2 },
    created_at: '2026-03-02T10:00:00Z',
    updated_at: '2026-03-02T10:00:00Z',
  },
  {
    ...mockEvaluator,
    version: '2026-03-01',
    config: { ...mockEvaluator.config, max_tokens: 128 },
    created_at: '2026-03-01T08:00:00Z',
    updated_at: '2026-03-01T08:00:00Z',
  },
];

const mockRule: Rule = {
  rule_id: 'stub',
  enabled: false,
  selector: 'user_visible_turn',
  match: {},
  sample_rate: 1,
  evaluator_ids: [],
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

const mockDataSource: EvaluationDataSource = {
  listRules: async () => ({ items: [], next_cursor: '' }),
  listEvaluators: async () => ({ items: mockEvaluatorVersions, next_cursor: '' }),
  listPredefinedEvaluators: async () => ({ items: [], next_cursor: '' }),
  createEvaluator: async (_req: CreateEvaluatorRequest) => mockEvaluator,
  getEvaluator: async (id: string) =>
    id === 'custom.helpfulness'
      ? mockEvaluator
      : { ...mockEvaluator, evaluator_id: id, config: {}, output_keys: [{ key: 'score', type: 'number' }] },
  deleteEvaluator: async () => {},
  forkPredefinedEvaluator: async (_id: string, _req: ForkEvaluatorRequest) => mockEvaluator,
  createRule: async () => mockRule,
  getRule: async () => mockRule,
  updateRule: async () => mockRule,
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
  forkTemplate: async () => mockEvaluator,
  listSavedConversations: async () => ({ items: [], next_cursor: '' }),
  saveConversation: async () => ({}) as never,
  getSavedConversation: async () => ({}) as never,
  deleteSavedConversation: async () => {},
  createManualConversation: async () => ({}) as never,
  listCollections: async () => ({ items: [], next_cursor: '' }),
  createCollection: async () => ({}) as never,
  getCollection: async () => ({}) as never,
  updateCollection: async () => ({}) as never,
  deleteCollection: async () => {},
  addCollectionMembers: async () => {},
  removeCollectionMember: async () => {},
  listCollectionMembers: async () => ({ items: [], next_cursor: '' }),
  listCollectionsForSavedConversation: async () => ({ items: [], next_cursor: '' }),
};

const meta = {
  title: 'Sigil/Evaluation/EditEvaluatorPage',
  component: EditEvaluatorPage,
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter initialEntries={['/a/grafana-sigil-app/evaluation/evaluators/custom.helpfulness/edit']}>
        <Routes>
          <Route path="/a/grafana-sigil-app/evaluation/evaluators/:evaluatorID/edit" element={<Story />} />
        </Routes>
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
