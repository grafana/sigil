import React from 'react';
import RevertEvaluatorForm from '../../components/evaluation/RevertEvaluatorForm';
import type { CreateEvaluatorRequest, Evaluator } from '../../evaluation/types';

const mockEvaluator: Evaluator = {
  evaluator_id: 'custom.helpfulness',
  version: '2026-03-01',
  kind: 'llm_judge',
  config: {
    system_prompt: 'You are an expert evaluator.',
    user_prompt: 'Score from 1-10.',
    max_tokens: 128,
    temperature: 0,
  },
  output_keys: [{ key: 'score', type: 'number' }],
  is_predefined: false,
  created_at: '2026-03-01T08:00:00Z',
  updated_at: '2026-03-01T08:00:00Z',
};

function RevertEvaluatorFormWrapper() {
  const handleSubmit = (req: CreateEvaluatorRequest) => {
    console.log('Revert submitted:', req);
  };
  const handleCancel = () => {
    console.log('Cancel clicked');
  };
  return (
    <RevertEvaluatorForm
      evaluator={mockEvaluator}
      existingVersions={['2026-03-01', '2026-03-04', '2026-03-04.1']}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
    />
  );
}

const meta = {
  title: 'Sigil/Evaluation/RevertEvaluatorForm',
  component: RevertEvaluatorForm,
};

export default meta;

export const Default = {
  render: () => <RevertEvaluatorFormWrapper />,
};
