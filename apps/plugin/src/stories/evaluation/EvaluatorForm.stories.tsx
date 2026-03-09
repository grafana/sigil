import React from 'react';
import { css } from '@emotion/css';
import EvaluatorForm from '../../components/evaluation/EvaluatorForm';
import type { CreateEvaluatorRequest, Evaluator } from '../../evaluation/types';

const storyContainer = css({
  maxWidth: 860,
});

function EvaluatorFormWrapper({ initialEvaluator }: { initialEvaluator?: Evaluator }) {
  const handleSubmit = (req: CreateEvaluatorRequest) => {
    console.log('Create submitted:', req);
  };
  const handleCancel = () => {
    console.log('Cancel clicked');
  };
  return (
    <div className={storyContainer}>
      <EvaluatorForm initialEvaluator={initialEvaluator} onSubmit={handleSubmit} onCancel={handleCancel} />
    </div>
  );
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

export const Heuristic = {
  render: () => (
    <EvaluatorFormWrapper
      initialEvaluator={{
        evaluator_id: 'custom.not-empty',
        version: '2025-01-15',
        kind: 'heuristic',
        description: 'Checks that the response contains meaningful content',
        config: {
          not_empty: true,
          min_length: 25,
        },
        output_keys: [{ key: 'passed', type: 'bool' }],
        is_predefined: false,
        created_at: '2025-01-15T00:00:00Z',
        updated_at: '2025-01-15T00:00:00Z',
      }}
    />
  ),
};

export const JSONSchema = {
  render: () => (
    <EvaluatorFormWrapper
      initialEvaluator={{
        evaluator_id: 'custom.json-valid',
        version: '2025-01-15',
        kind: 'json_schema',
        description: 'Checks whether the assistant returns valid structured JSON',
        config: {
          schema: {
            type: 'object',
            required: ['answer'],
            properties: {
              answer: { type: 'string' },
            },
          },
        },
        output_keys: [{ key: 'json_valid', type: 'bool' }],
        is_predefined: false,
        created_at: '2025-01-15T00:00:00Z',
        updated_at: '2025-01-15T00:00:00Z',
      }}
    />
  ),
};
