import React from 'react';
import { css } from '@emotion/css';
import TemplateForm from '../../components/evaluation/TemplateForm';
import type { CreateTemplateRequest } from '../../evaluation/types';
import type { EvaluationDataSource } from '../../evaluation/api';

const storyContainer = css({
  maxWidth: 860,
});

const mockDataSource = {
  listJudgeProviders: async () => ({ providers: [] }),
  listJudgeModels: async () => ({ models: [] }),
} as unknown as EvaluationDataSource;

function TemplateFormWrapper() {
  const handleSubmit = (req: CreateTemplateRequest) => {
    console.log('Create template submitted:', req);
  };
  const handleCancel = () => {
    console.log('Cancel clicked');
  };

  return (
    <div className={storyContainer}>
      <TemplateForm onSubmit={handleSubmit} onCancel={handleCancel} dataSource={mockDataSource} />
    </div>
  );
}

const meta = {
  title: 'Sigil/Evaluation/TemplateForm',
  component: TemplateForm,
};

export default meta;

export const Default = {
  render: () => <TemplateFormWrapper />,
  parameters: {
    docs: {
      description: {
        story:
          'Switch the Kind field to compare flexible LLM Judge outputs with fixed-bool kinds like JSON Schema, Regex, and Heuristic.',
      },
    },
  },
};
