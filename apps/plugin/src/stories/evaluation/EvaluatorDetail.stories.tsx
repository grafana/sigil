import EvaluatorDetail from '../../components/evaluation/EvaluatorDetail';
import type { Evaluator } from '../../evaluation/types';

const mockLLMJudge: Evaluator = {
  evaluator_id: 'sigil.helpfulness',
  version: '2026-03-05',
  kind: 'llm_judge',
  config: {
    system_prompt:
      'You evaluate one assistant response. Use only the user input and assistant output. Follow the score field description exactly. Be strict. If uncertain, choose the lower score.',
    user_prompt: 'Latest user message:\n{{latest_user_message}}\n\nAssistant response:\n{{assistant_response}}',
    max_tokens: 128,
    temperature: 0,
  },
  output_keys: [
    {
      key: 'helpfulness',
      type: 'number',
      description:
        '1-2 does not solve the request, 3-4 partially helpful, 5-6 adequate but incomplete, 7-8 helpful and mostly complete, 9-10 fully solves the request with clear useful detail',
      pass_threshold: 7,
      min: 1,
      max: 10,
    },
  ],
  is_predefined: true,
  created_at: '2026-03-05T00:00:00Z',
  updated_at: '2026-03-05T00:00:00Z',
};

const mockStringJudge: Evaluator = {
  evaluator_id: 'custom.severity',
  version: '2026-03-04',
  kind: 'llm_judge',
  config: {
    system_prompt: 'Classify the severity of the issue in the response.',
    user_prompt:
      'Latest user message: {{latest_user_message}}\n\nAssistant response: {{assistant_response}}\n\nClassify severity.',
  },
  output_keys: [
    {
      key: 'severity',
      type: 'string',
      enum: ['none', 'mild', 'moderate', 'severe'],
      pass_match: ['none', 'mild'],
    },
  ],
  is_predefined: false,
  created_at: '2026-03-04T00:00:00Z',
  updated_at: '2026-03-04T00:00:00Z',
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

export const StringJudgeWithPassMatch = {
  args: {
    evaluator: mockStringJudge,
  },
};
