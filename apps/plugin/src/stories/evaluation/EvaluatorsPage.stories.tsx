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
    config: {},
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
};

const meta = {
  title: 'Sigil/Evaluation/EvaluatorsPage',
  component: EvaluatorsPage,
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
