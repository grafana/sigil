import React from 'react';
import EvaluatorForm from '../../components/evaluation/EvaluatorForm';
import type { CreateEvaluatorRequest, Evaluator } from '../../evaluation/types';

function EvaluatorFormWrapper({ initialEvaluator }: { initialEvaluator?: Evaluator }) {
  const handleSubmit = (req: CreateEvaluatorRequest) => {
    console.log('Create submitted:', req);
  };
  const handleCancel = () => {
    console.log('Cancel clicked');
  };
  return <EvaluatorForm initialEvaluator={initialEvaluator} onSubmit={handleSubmit} onCancel={handleCancel} />;
}

const meta = {
  title: 'Sigil/Evaluation/EvaluatorForm',
  component: EvaluatorForm,
};

export default meta;

export const Default = {
  render: () => <EvaluatorFormWrapper />,
};

export const WithDescription = {
  render: () => (
    <EvaluatorFormWrapper
      initialEvaluator={{
        evaluator_id: 'custom.helpfulness',
        version: '2025-01-15',
        kind: 'llm_judge',
        description: 'Rates how helpful the response is on a 1–10 scale',
        config: {},
        output_keys: [{ key: 'score', type: 'number' }],
        is_predefined: false,
        created_at: '2025-01-15T00:00:00Z',
        updated_at: '2025-01-15T00:00:00Z',
      }}
    />
  ),
};
