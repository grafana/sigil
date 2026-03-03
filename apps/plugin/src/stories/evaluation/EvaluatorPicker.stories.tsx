import React, { useState } from 'react';
import EvaluatorPicker from '../../components/evaluation/EvaluatorPicker';
import { FieldSet } from '@grafana/ui';
import type { Evaluator } from '../../evaluation/types';

const mockEvaluators: Evaluator[] = [
  {
    evaluator_id: 'sigil.helpfulness',
    version: '2026-02-17',
    kind: 'llm_judge',
    config: { user_prompt: 'Score helpfulness 1-10.' },
    output_keys: [{ key: 'helpfulness', type: 'number' }],
    is_predefined: true,
    created_at: '2026-02-17T00:00:00Z',
    updated_at: '2026-02-17T00:00:00Z',
  },
  {
    evaluator_id: 'sigil.json_valid',
    version: '2026-02-17',
    kind: 'json_schema',
    config: { schema: {} },
    output_keys: [{ key: 'valid', type: 'bool' }],
    is_predefined: true,
    created_at: '2026-02-17T00:00:00Z',
    updated_at: '2026-02-17T00:00:00Z',
  },
  {
    evaluator_id: 'custom.toxicity',
    version: '1.0.0',
    kind: 'llm_judge',
    config: { user_prompt: 'Is this toxic?' },
    output_keys: [{ key: 'toxic', type: 'bool' }],
    is_predefined: false,
    created_at: '2026-02-17T00:00:00Z',
    updated_at: '2026-02-17T00:00:00Z',
  },
];

function EvaluatorPickerWrapper() {
  const [value, setValue] = useState<string[]>(['sigil.helpfulness']);
  return (
    <FieldSet label="Evaluators">
      <EvaluatorPicker value={value} evaluators={mockEvaluators} onChange={setValue} />
    </FieldSet>
  );
}

const meta = {
  title: 'Sigil/Evaluation/EvaluatorPicker',
  component: EvaluatorPicker,
};

export default meta;

export const Default = {
  render: () => <EvaluatorPickerWrapper />,
};

export const Empty = {
  args: {
    value: [],
    evaluators: mockEvaluators,
    onChange: () => {},
  },
};

export const MultipleSelected = {
  args: {
    value: ['sigil.helpfulness', 'sigil.json_valid'],
    evaluators: mockEvaluators,
    onChange: () => {},
  },
};
