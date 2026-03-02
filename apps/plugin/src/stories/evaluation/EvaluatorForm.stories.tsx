import React from 'react';
import EvaluatorForm from '../../components/evaluation/EvaluatorForm';
import type { CreateEvaluatorRequest } from '../../evaluation/types';

function EvaluatorFormWrapper() {
  const handleSubmit = (req: CreateEvaluatorRequest) => {
    console.log('Create submitted:', req);
  };
  const handleCancel = () => {
    console.log('Cancel clicked');
  };
  return <EvaluatorForm onSubmit={handleSubmit} onCancel={handleCancel} />;
}

const meta = {
  title: 'Sigil/Evaluation/EvaluatorForm',
  component: EvaluatorForm,
};

export default meta;

export const Default = {
  render: () => <EvaluatorFormWrapper />,
};
