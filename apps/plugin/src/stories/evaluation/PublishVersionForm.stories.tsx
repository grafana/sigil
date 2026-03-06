import React from 'react';
import { css } from '@emotion/css';
import PublishVersionForm from '../../components/evaluation/PublishVersionForm';
import type { PublishVersionRequest } from '../../evaluation/types';
import type { EvaluationDataSource } from '../../evaluation/api';

const storyContainer = css({
  maxWidth: 860,
});

const mockDataSource = {
  listJudgeProviders: async () => ({ providers: [] }),
  listJudgeModels: async () => ({ models: [] }),
} as unknown as EvaluationDataSource;

function PublishVersionFormWrapper() {
  const handleSubmit = (req: PublishVersionRequest) => {
    console.log('Publish version submitted:', req);
  };
  const handleCancel = () => {
    console.log('Cancel clicked');
  };

  return (
    <div className={storyContainer}>
      <PublishVersionForm
        kind="llm_judge"
        initialConfig={{
          system_prompt: 'You are grading helpfulness.',
          user_prompt: '{{input}}\n\n{{output}}',
          max_tokens: 256,
          temperature: 0,
        }}
        initialOutputKeys={[{ key: 'score', type: 'number', description: 'Helpfulness score' }]}
        existingVersions={['2026-03-01', '2026-03-02']}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        dataSource={mockDataSource}
      />
    </div>
  );
}

const meta = {
  title: 'Sigil/Evaluation/PublishVersionForm',
  component: PublishVersionForm,
};

export default meta;

export const Default = {
  render: () => <PublishVersionFormWrapper />,
};
