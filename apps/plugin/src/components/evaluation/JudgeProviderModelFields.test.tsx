import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SelectableValue } from '@grafana/data';
import JudgeProviderModelFields from './JudgeProviderModelFields';

const providerOptions: Array<SelectableValue<string>> = [{ label: 'OpenAI', value: 'openai' }];
const initialModelOptions: Array<SelectableValue<string>> = [{ label: 'gpt-4o', value: 'gpt-4o' }];

function Harness({ onFieldsRender }: { onFieldsRender: jest.Mock }) {
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-4o');
  const [modelOptions, setModelOptions] = useState(initialModelOptions);

  return (
    <>
      <input aria-label="Prompt text" value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} />
      <JudgeProviderModelFields
        compactControlClassName=""
        provider={provider}
        model={model}
        providerOptions={providerOptions}
        modelOptions={modelOptions}
        setProvider={setProvider}
        setModel={setModel}
        setModelOptions={setModelOptions}
        onRender={onFieldsRender}
      />
    </>
  );
}

describe('JudgeProviderModelFields', () => {
  it('does not rerender when unrelated prompt state changes', () => {
    const onFieldsRender = jest.fn();

    render(<Harness onFieldsRender={onFieldsRender} />);

    expect(onFieldsRender).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Prompt text'), { target: { value: 'x' } });

    expect(onFieldsRender).toHaveBeenCalledTimes(1);
  });
});
