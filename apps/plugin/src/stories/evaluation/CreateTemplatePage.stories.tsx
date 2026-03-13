import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import CreateTemplatePage from '../../pages/CreateTemplatePage';
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
  version: '1.0.0',
  kind: 'llm_judge',
  config: {},
  output_keys: [{ key: 'score', type: 'number' }],
  is_predefined: false,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

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
  listEvaluators: async () => ({ items: [], next_cursor: '' }),
  listPredefinedEvaluators: async () => ({ items: [], next_cursor: '' }),
  createEvaluator: async (_req: CreateEvaluatorRequest) => mockEvaluator,
  getEvaluator: async () => mockEvaluator,
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
  saveConversation: async () => ({
    tenant_id: '',
    saved_id: '',
    conversation_id: '',
    name: '',
    source: 'telemetry' as const,
    tags: {},
    saved_by: '',
    created_at: '',
    updated_at: '',
    generation_count: 0,
    total_tokens: 0,
    agent_names: [],
  }),
  getSavedConversation: async () => ({
    tenant_id: '',
    saved_id: '',
    conversation_id: '',
    name: '',
    source: 'telemetry' as const,
    tags: {},
    saved_by: '',
    created_at: '',
    updated_at: '',
    generation_count: 0,
    total_tokens: 0,
    agent_names: [],
  }),
  deleteSavedConversation: async () => {},
  createManualConversation: async () => ({
    tenant_id: '',
    saved_id: '',
    conversation_id: '',
    name: '',
    source: 'manual' as const,
    tags: {},
    saved_by: '',
    created_at: '',
    updated_at: '',
    generation_count: 0,
    total_tokens: 0,
    agent_names: [],
  }),
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
  title: 'Sigil/Evaluation/CreateTemplatePage',
  component: CreateTemplatePage,
  decorators: [
    (Story: React.ComponentType) => (
      <MemoryRouter>
        <Story />
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
