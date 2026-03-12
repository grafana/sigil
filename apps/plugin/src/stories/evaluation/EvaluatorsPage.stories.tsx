import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import EvaluatorsPage from '../../pages/EvaluatorsPage';
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

const mockEvaluators: Evaluator[] = [
  {
    evaluator_id: 'prod.helpfulness.v1',
    version: '2026-02-17',
    kind: 'llm_judge',
    config: { system_prompt: 'You are a judge.', user_prompt: 'Score: {{ generation }}' },
    output_keys: [{ key: 'helpfulness', type: 'number' }],
    is_predefined: false,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
  {
    evaluator_id: 'prod.not_empty',
    version: '2026-02-17',
    kind: 'heuristic',
    config: {
      version: 'v2',
      root: {
        kind: 'group',
        operator: 'and',
        rules: [{ kind: 'rule', type: 'not_empty' }],
      },
    },
    output_keys: [{ key: 'not_empty', type: 'bool' }],
    is_predefined: false,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
];

const mockPredefined: Evaluator[] = [
  {
    evaluator_id: 'sigil.helpfulness',
    version: '1.0',
    kind: 'llm_judge',
    config: { system_prompt: 'Judge template.', user_prompt: '{{ generation }}' },
    output_keys: [{ key: 'score', type: 'number' }],
    is_predefined: true,
    created_at: '2026-02-18T00:00:00Z',
    updated_at: '2026-02-18T00:00:00Z',
  },
];

const mockRule: Rule = {
  rule_id: 'online.helpfulness',
  enabled: true,
  selector: 'user_visible_turn',
  match: {},
  sample_rate: 0.1,
  evaluator_ids: [],
  created_at: '2026-02-18T00:00:00Z',
  updated_at: '2026-02-18T00:00:00Z',
};

const mockDataSource: EvaluationDataSource = {
  listRules: async () => ({ items: [mockRule], next_cursor: '' }),
  listEvaluators: async () => ({ items: mockEvaluators, next_cursor: '' }),
  listPredefinedEvaluators: async () => ({ items: mockPredefined, next_cursor: '' }),
  createEvaluator: async (req: CreateEvaluatorRequest) => ({
    ...mockEvaluators[0],
    evaluator_id: req.evaluator_id,
    version: req.version,
    kind: req.kind,
    config: req.config,
    output_keys: req.output_keys,
  }),
  getEvaluator: async (id: string) =>
    mockEvaluators.find((e) => e.evaluator_id === id) ??
    mockPredefined.find((e) => e.evaluator_id === id) ??
    mockEvaluators[0],
  deleteEvaluator: async () => {},
  forkPredefinedEvaluator: async (_templateID: string, req: ForkEvaluatorRequest) => ({
    ...mockEvaluators[0],
    evaluator_id: req.evaluator_id,
    is_predefined: false,
  }),
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
  listTemplates: async () => ({
    items: [
      {
        tenant_id: 'tenant-1',
        template_id: 'my-org.custom-helpfulness',
        scope: 'tenant' as const,
        kind: 'llm_judge' as const,
        description: 'Custom helpfulness evaluator tuned for our product domain.',
        latest_version: '2026-03-01',
        output_keys: [{ key: 'score', type: 'number' as const }],
        versions: [],
        created_at: '2026-03-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
      },
      {
        tenant_id: 'tenant-1',
        template_id: 'my-org.brand-voice',
        scope: 'tenant' as const,
        kind: 'llm_judge' as const,
        description: 'Checks if the response matches our brand voice guidelines.',
        latest_version: '2026-03-02',
        output_keys: [{ key: 'on_brand', type: 'bool' as const }],
        versions: [],
        created_at: '2026-03-02T00:00:00Z',
        updated_at: '2026-03-02T00:00:00Z',
      },
      {
        tenant_id: '',
        template_id: 'sigil.helpfulness',
        scope: 'global' as const,
        kind: 'llm_judge' as const,
        description: 'Score how helpful and complete the assistant response is for the user request.',
        latest_version: '2026-02-17',
        output_keys: [{ key: 'score', type: 'number' as const }],
        versions: [],
        created_at: '',
        updated_at: '',
      },
      {
        tenant_id: '',
        template_id: 'sigil.toxicity',
        scope: 'global' as const,
        kind: 'llm_judge' as const,
        description: 'Return true when the response includes toxic, hateful, abusive, or offensive content.',
        latest_version: '2026-02-17',
        output_keys: [{ key: 'is_toxic', type: 'bool' as const }],
        versions: [],
        created_at: '',
        updated_at: '',
      },
      {
        tenant_id: '',
        template_id: 'sigil.json_valid',
        scope: 'global' as const,
        kind: 'json_schema' as const,
        description: 'Return true when the response is valid JSON matching the provided schema.',
        latest_version: '2026-02-17',
        output_keys: [{ key: 'is_valid', type: 'bool' as const }],
        versions: [],
        created_at: '',
        updated_at: '',
      },
      {
        tenant_id: '',
        template_id: 'sigil.response_not_empty',
        scope: 'global' as const,
        kind: 'heuristic' as const,
        description: 'Return true when the assistant response is non-empty.',
        latest_version: '2026-02-17',
        output_keys: [{ key: 'not_empty', type: 'bool' as const }],
        versions: [],
        created_at: '',
        updated_at: '',
      },
    ],
    next_cursor: '',
  }),
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
  forkTemplate: async () => ({ ...mockEvaluators[0] }),
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
  title: 'Sigil/Evaluation/EvaluatorsPage',
  component: EvaluatorsPage,
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

export const Empty = {
  args: {
    dataSource: {
      ...mockDataSource,
      listEvaluators: async () => ({ items: [], next_cursor: '' }),
      listPredefinedEvaluators: async () => ({ items: [], next_cursor: '' }),
    },
  },
};
