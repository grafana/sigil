import EvaluatorTemplateCard from '../../components/evaluation/EvaluatorTemplateCard';
import type { Evaluator } from '../../evaluation/types';

const mockLLMJudge: Evaluator = {
  evaluator_id: 'sigil.helpfulness',
  version: '2026-02-17',
  kind: 'llm_judge',
  config: {
    system_prompt: 'You are an evaluation judge.',
    user_prompt: 'Score how helpful the assistant response is on a scale of 1-10.',
    max_tokens: 256,
    temperature: 0,
  },
  output_keys: [{ key: 'helpfulness', type: 'number' }],
  is_predefined: true,
  created_at: '2026-02-17T00:00:00Z',
  updated_at: '2026-02-17T00:00:00Z',
};

const mockJSONSchema: Evaluator = {
  evaluator_id: 'sigil.json_valid',
  version: '2026-02-17',
  kind: 'json_schema',
  config: {
    schema: { type: 'object', properties: { result: { type: 'string' } } },
  },
  output_keys: [{ key: 'valid', type: 'bool' }],
  is_predefined: true,
  created_at: '2026-02-17T00:00:00Z',
  updated_at: '2026-02-17T00:00:00Z',
};

const mockHeuristic: Evaluator = {
  evaluator_id: 'sigil.response_not_empty',
  version: '2026-02-17',
  kind: 'heuristic',
  config: {},
  output_keys: [{ key: 'not_empty', type: 'bool' }],
  is_predefined: true,
  created_at: '2026-02-17T00:00:00Z',
  updated_at: '2026-02-17T00:00:00Z',
};

const mockBoolOutput: Evaluator = {
  evaluator_id: 'sigil.toxicity',
  version: '2026-02-17',
  kind: 'llm_judge',
  config: {
    user_prompt: 'Is the response toxic? Answer yes or no.',
  },
  output_keys: [{ key: 'toxic', type: 'bool' }],
  is_predefined: true,
  created_at: '2026-02-17T00:00:00Z',
  updated_at: '2026-02-17T00:00:00Z',
};

const meta = {
  title: 'Sigil/Evaluation/EvaluatorTemplateCard',
  component: EvaluatorTemplateCard,
};

export default meta;

export const LLMJudge = {
  args: {
    evaluator: mockLLMJudge,
    onFork: (id: string) => {
      console.log('Fork:', id);
    },
  },
};

export const JSONSchema = {
  args: {
    evaluator: mockJSONSchema,
    onFork: (id: string) => {
      console.log('Fork:', id);
    },
  },
};

export const Heuristic = {
  args: {
    evaluator: mockHeuristic,
    onFork: (id: string) => {
      console.log('Fork:', id);
    },
  },
};

export const BoolOutput = {
  args: {
    evaluator: mockBoolOutput,
    onFork: (id: string) => {
      console.log('Fork:', id);
    },
  },
};
