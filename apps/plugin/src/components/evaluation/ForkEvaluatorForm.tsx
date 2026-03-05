import React, { useEffect, useState } from 'react';
import type { SelectableValue } from '@grafana/data';
import { Button, Field, FieldSet, Input, Select, Stack } from '@grafana/ui';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { ForkEvaluatorRequest } from '../../evaluation/types';
import { isValidResourceID, INVALID_ID_MESSAGE } from '../../evaluation/utils';

export type ForkEvaluatorFormProps = {
  templateID: string;
  onSubmit: (req: ForkEvaluatorRequest) => void;
  onCancel: () => void;
  dataSource: Pick<EvaluationDataSource, 'listJudgeProviders' | 'listJudgeModels'>;
};

export default function ForkEvaluatorForm({ templateID, onSubmit, onCancel, dataSource }: ForkEvaluatorFormProps) {
  const [evaluatorId, setEvaluatorId] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [touched, setTouched] = useState(false);
  const [providerOptions, setProviderOptions] = useState<Array<SelectableValue<string>>>([]);
  const [modelOptions, setModelOptions] = useState<Array<SelectableValue<string>>>([]);

  useEffect(() => {
    void dataSource
      .listJudgeProviders()
      .then((res) => {
        setProviderOptions(res.providers.map((p) => ({ label: p.name, value: p.id })));
      })
      .catch(() => {});
  }, [dataSource]);

  useEffect(() => {
    if (provider == null || provider === '') {
      return;
    }
    void dataSource
      .listJudgeModels(provider)
      .then((res) => {
        setModelOptions(res.models.map((m) => ({ label: m.name, value: m.id })));
      })
      .catch(() => {});
  }, [dataSource, provider]);

  const isIdEmpty = evaluatorId.trim() === '';
  const isIdInvalid = !isIdEmpty && !isValidResourceID(evaluatorId.trim());
  const idError = isIdEmpty ? 'Evaluator ID is required' : isIdInvalid ? INVALID_ID_MESSAGE : undefined;
  const showIdError = touched && (isIdEmpty || isIdInvalid);

  const handleSubmit = () => {
    setTouched(true);
    if (isIdEmpty || isIdInvalid) {
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
        error={idError}
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
          options={providerOptions}
          value={provider}
          onChange={(v) => {
            setProvider(v?.value ?? null);
            setModel('');
            setModelOptions([]);
          }}
          isClearable
          placeholder="Keep template default"
          width={30}
        />
      </Field>
      <Field label="Model override" description="Optional. Override the model for llm_judge evaluators.">
        <Select<string>
          options={modelOptions}
          value={model || null}
          onChange={(v) => setModel(v?.value ?? '')}
          isClearable
          allowCustomValue
          placeholder="e.g. gpt-4o"
          width={40}
        />
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
