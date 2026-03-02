import EvaluatorTemplateGrid from '../../components/evaluation/EvaluatorTemplateGrid';
import type { Evaluator } from '../../evaluation/types';

const baseEvaluator = (
  evaluator_id: string,
  kind: Evaluator['kind'],
  user_prompt: string,
  outputKey: string,
  outputType: 'number' | 'bool' | 'string' = 'number'
): Evaluator => ({
  evaluator_id,
  version: '2026-02-17',
  kind,
  config: { user_prompt },
  output_keys: [{ key: outputKey, type: outputType }],
  is_predefined: true,
  created_at: '2026-02-17T00:00:00Z',
  updated_at: '2026-02-17T00:00:00Z',
});

const predefinedTemplates: Evaluator[] = [
  baseEvaluator('sigil.helpfulness', 'llm_judge', 'Score how helpful the response is.', 'helpfulness'),
  baseEvaluator('sigil.toxicity', 'llm_judge', 'Is the response toxic?', 'toxic', 'bool'),
  baseEvaluator('sigil.pii', 'llm_judge', 'Does the response contain PII?', 'has_pii', 'bool'),
  baseEvaluator('sigil.hallucination', 'llm_judge', 'Does the response hallucinate facts?', 'hallucination', 'bool'),
  baseEvaluator('sigil.relevance', 'llm_judge', 'How relevant is the response to the input?', 'relevance'),
  baseEvaluator('sigil.conciseness', 'llm_judge', 'How concise is the response?', 'conciseness'),
  baseEvaluator(
    'sigil.format_adherence',
    'llm_judge',
    'Does the response follow the required format?',
    'adherent',
    'bool'
  ),
  {
    ...baseEvaluator('sigil.json_valid', 'json_schema', 'Validates JSON structure.', 'valid', 'bool'),
    config: { schema: { type: 'object' } },
  },
  baseEvaluator('sigil.response_not_empty', 'heuristic', 'Checks if response is non-empty.', 'not_empty', 'bool'),
  baseEvaluator('sigil.response_length', 'heuristic', 'Measures response length.', 'length'),
];

const meta = {
  title: 'Sigil/Evaluation/EvaluatorTemplateGrid',
  component: EvaluatorTemplateGrid,
};

export default meta;

export const AllPredefinedTemplates = {
  args: {
    evaluators: predefinedTemplates,
    onFork: (id: string) => {
      console.log('Fork:', id);
    },
  },
};
