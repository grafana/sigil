import EvaluatorCardGrid from '../../components/evaluation/EvaluatorCardGrid';
import type { Evaluator } from '../../evaluation/types';

const mockTenantEvaluators: Evaluator[] = [
  {
    evaluator_id: 'my-company.helpfulness-v2',
    version: '2026-02-20',
    kind: 'llm_judge',
    description: 'Scores how helpful and complete a response is for customer support conversations.',
    config: {
      user_prompt: 'Score helpfulness from 1-10.',
    },
    output_keys: [{ key: 'helpfulness', type: 'number' }],
    is_predefined: false,
    created_at: '2026-02-20T10:00:00Z',
    updated_at: '2026-02-20T10:00:00Z',
  },
  {
    evaluator_id: 'my-company.toxicity-check',
    version: '2026-02-19',
    kind: 'llm_judge',
    description: 'Flags abusive, hateful, or demeaning assistant output before it reaches end users.',
    config: {
      user_prompt: 'Is this response toxic?',
    },
    output_keys: [{ key: 'toxic', type: 'bool' }],
    is_predefined: false,
    created_at: '2026-02-19T14:30:00Z',
    updated_at: '2026-02-19T14:30:00Z',
  },
  {
    evaluator_id: 'my-company.json-validator',
    version: '2026-02-18',
    kind: 'json_schema',
    description: 'Validates assistant output against the required support-case JSON contract.',
    config: { schema: { type: 'object' } },
    output_keys: [{ key: 'valid', type: 'bool' }],
    is_predefined: false,
    created_at: '2026-02-18T09:00:00Z',
    updated_at: '2026-02-18T09:00:00Z',
  },
];

const meta = {
  title: 'Sigil/Evaluation/EvaluatorCardGrid',
  component: EvaluatorCardGrid,
};

export default meta;

export const Default = {
  args: {
    evaluators: mockTenantEvaluators,
    onSelect: (id: string) => {
      console.log('Select:', id);
    },
    onDelete: (id: string) => {
      console.log('Delete:', id);
    },
  },
};
