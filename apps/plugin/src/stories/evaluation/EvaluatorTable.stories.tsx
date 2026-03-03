import EvaluatorTable from '../../components/evaluation/EvaluatorTable';
import type { Evaluator } from '../../evaluation/types';

const mockTenantEvaluators: Evaluator[] = [
  {
    evaluator_id: 'my-company.helpfulness-v2',
    version: '2026-02-20',
    kind: 'llm_judge',
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
    config: { schema: { type: 'object' } },
    output_keys: [{ key: 'valid', type: 'bool' }],
    is_predefined: false,
    created_at: '2026-02-18T09:00:00Z',
    updated_at: '2026-02-18T09:00:00Z',
  },
];

const meta = {
  title: 'Sigil/Evaluation/EvaluatorTable',
  component: EvaluatorTable,
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

export const WithoutActions = {
  args: {
    evaluators: mockTenantEvaluators,
  },
};
