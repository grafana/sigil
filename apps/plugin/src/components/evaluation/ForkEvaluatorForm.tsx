import React, { useState } from 'react';
import type { SelectableValue } from '@grafana/data';
import { Button, Field, FieldSet, Input, Select, Stack } from '@grafana/ui';
import type { ForkEvaluatorRequest } from '../../evaluation/types';

export type ForkEvaluatorFormProps = {
  templateID: string;
  onSubmit: (req: ForkEvaluatorRequest) => void;
  onCancel: () => void;
};

const PROVIDER_OPTIONS: Array<SelectableValue<string>> = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Azure', value: 'azure' },
  { label: 'OpenRouter', value: 'openrouter' },
];

export default function ForkEvaluatorForm({ templateID, onSubmit, onCancel }: ForkEvaluatorFormProps) {
  const [evaluatorId, setEvaluatorId] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [touched, setTouched] = useState(false);

  const isIdEmpty = evaluatorId.trim() === '';
  const showIdError = touched && isIdEmpty;

  const handleSubmit = () => {
    setTouched(true);
    if (isIdEmpty) {
      return;
    }
    const req: ForkEvaluatorRequest = {
      evaluator_id: evaluatorId.trim(),
    };
    const configOverrides: Record<string, unknown> = {};
    if (provider != null && provider !== '') {
      configOverrides.provider = provider;
    }
    if (model.trim() !== '') {
      configOverrides.model = model.trim();
    }
    if (Object.keys(configOverrides).length > 0) {
      req.config = configOverrides;
    }
    onSubmit(req);
  };

  return (
    <FieldSet label="Fork evaluator">
      <Field
        label="Evaluator ID"
        description="Unique ID for your forked evaluator. Required."
        required
        invalid={showIdError}
        error={showIdError ? 'Evaluator ID is required' : undefined}
      >
        <Input
          value={evaluatorId}
          onChange={(e) => setEvaluatorId(e.currentTarget.value)}
          onBlur={() => setTouched(true)}
          placeholder={templateID}
          width={40}
        />
      </Field>
      <Field label="Provider override" description="Optional. Override the LLM provider for llm_judge evaluators.">
        <Select<string>
          options={PROVIDER_OPTIONS}
          value={provider}
          onChange={(v) => setProvider(v?.value ?? null)}
          isClearable
          placeholder="Keep template default"
          width={24}
        />
      </Field>
      <Field label="Model override" description="Optional. Override the model for llm_judge evaluators.">
        <Input value={model} onChange={(e) => setModel(e.currentTarget.value)} placeholder="e.g. gpt-4o" width={40} />
      </Field>
      <Stack direction="row" gap={1}>
        <Button onClick={handleSubmit}>Fork</Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </FieldSet>
  );
}
