import React from 'react';
import ForkEvaluatorForm, { type ForkEvaluatorFormProps } from '../../components/evaluation/ForkEvaluatorForm';
import type { ForkEvaluatorRequest } from '../../evaluation/types';

const mockDataSource: ForkEvaluatorFormProps['dataSource'] = {
  listJudgeProviders: async () => ({
    providers: [
      { id: 'openai', name: 'OpenAI', type: 'openai' },
      { id: 'anthropic', name: 'Anthropic', type: 'anthropic' },
      { id: 'azure', name: 'Azure', type: 'azure' },
      { id: 'openrouter', name: 'OpenRouter', type: 'openrouter' },
    ],
  }),
  listJudgeModels: async () => ({ models: [] }),
};

function ForkEvaluatorFormWrapper() {
  const handleSubmit = (req: ForkEvaluatorRequest) => {
    console.log('Fork submitted:', req);
  };
  const handleCancel = () => {
    console.log('Cancel clicked');
  };
  return (
    <ForkEvaluatorForm
      templateID="sigil.helpfulness"
      onSubmit={handleSubmit}
      onCancel={handleCancel}
      dataSource={mockDataSource}
    />
  );
}

const meta = {
  title: 'Sigil/Evaluation/ForkEvaluatorForm',
  component: ForkEvaluatorForm,
};

export default meta;

export const Default = {
  render: () => <ForkEvaluatorFormWrapper />,
};
