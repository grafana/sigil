import React, { type Dispatch, type SetStateAction } from 'react';
import type { SelectableValue } from '@grafana/data';
import { Field, Select } from '@grafana/ui';

export type JudgeProviderModelFieldsProps = {
  compactControlClassName: string;
  provider: string;
  model: string;
  providerOptions: Array<SelectableValue<string>>;
  modelOptions: Array<SelectableValue<string>>;
  setProvider: Dispatch<SetStateAction<string>>;
  setModel: Dispatch<SetStateAction<string>>;
  setModelOptions: Dispatch<SetStateAction<Array<SelectableValue<string>>>>;
  onRender?: () => void;
};

function JudgeProviderModelFields({
  compactControlClassName,
  provider,
  model,
  providerOptions,
  modelOptions,
  setProvider,
  setModel,
  setModelOptions,
  onRender,
}: JudgeProviderModelFieldsProps) {
  onRender?.();

  return (
    <>
      <Field
        label="Provider"
        description="Optional. Override the default judge target with both fields, or use a fully-qualified model."
      >
        <Select<string>
          className={compactControlClassName}
          options={providerOptions}
          value={provider || undefined}
          onChange={(next) => {
            setProvider(next?.value ?? '');
            setModel('');
            setModelOptions([]);
          }}
          isClearable
          placeholder="Default"
        />
      </Field>
      <Field
        label="Model"
        description="Optional. Override the default judge target with both fields, or use a fully-qualified model."
      >
        <Select<string>
          className={compactControlClassName}
          options={modelOptions}
          value={model || undefined}
          onChange={(next) => setModel(next?.value ?? '')}
          isClearable
          allowCustomValue
          placeholder="Default"
        />
      </Field>
    </>
  );
}

export default React.memo(JudgeProviderModelFields);
