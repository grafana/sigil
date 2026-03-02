import React from 'react';
import ForkEvaluatorForm from '../../components/evaluation/ForkEvaluatorForm';
import type { ForkEvaluatorRequest } from '../../evaluation/types';

function ForkEvaluatorFormWrapper() {
  const handleSubmit = (req: ForkEvaluatorRequest) => {
    console.log('Fork submitted:', req);
  };
  const handleCancel = () => {
    console.log('Cancel clicked');
  };
  return <ForkEvaluatorForm templateID="sigil.helpfulness" onSubmit={handleSubmit} onCancel={handleCancel} />;
}

const meta = {
  title: 'Sigil/Evaluation/ForkEvaluatorForm',
  component: ForkEvaluatorForm,
};

export default meta;

export const Default = {
  render: () => <ForkEvaluatorFormWrapper />,
};
