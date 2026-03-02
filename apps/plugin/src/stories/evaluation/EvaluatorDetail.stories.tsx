import EvaluatorDetail from '../../components/evaluation/EvaluatorDetail';
import type { Evaluator } from '../../evaluation/types';

const mockLLMJudge: Evaluator = {
  evaluator_id: 'sigil.helpfulness',
  version: '2026-02-17',
  kind: 'llm_judge',
  config: {
    system_prompt: 'You are an evaluation judge. Be fair and consistent.',
    user_prompt:
      'Given the input: {{input}}\n\nAnd the assistant output: {{output}}\n\nScore how helpful the response is on a scale of 1-10. Respond with a JSON object: {"helpfulness": <number>}',
    max_tokens: 256,
    temperature: 0,
  },
  output_keys: [{ key: 'helpfulness', type: 'number', pass_threshold: 7 }],
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

const meta = {
  title: 'Sigil/Evaluation/EvaluatorDetail',
  component: EvaluatorDetail,
};

export default meta;

export const LLMJudge = {
  args: {
    evaluator: mockLLMJudge,
  },
};

export const Heuristic = {
  args: {
    evaluator: mockHeuristic,
  },
};
