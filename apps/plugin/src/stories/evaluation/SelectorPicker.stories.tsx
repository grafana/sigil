import React, { useState } from 'react';
import SelectorPicker from '../../components/evaluation/SelectorPicker';
import { FieldSet } from '@grafana/ui';
import type { RuleSelector } from '../../evaluation/types';

function SelectorPickerWrapper() {
  const [value, setValue] = useState<RuleSelector>('user_visible_turn');
  return (
    <FieldSet label="Selector">
      <SelectorPicker value={value} onChange={setValue} />
    </FieldSet>
  );
}

const meta = {
  title: 'Sigil/Evaluation/SelectorPicker',
  component: SelectorPicker,
};

export default meta;

export const Default = {
  render: () => <SelectorPickerWrapper />,
};

export const AllAssistantGenerations = {
  args: {
    value: 'all_assistant_generations' as RuleSelector,
    onChange: () => {},
  },
};

export const ToolCallSteps = {
  args: {
    value: 'tool_call_steps' as RuleSelector,
    onChange: () => {},
  },
};

export const ErroredGenerations = {
  args: {
    value: 'errored_generations' as RuleSelector,
    onChange: () => {},
  },
};
