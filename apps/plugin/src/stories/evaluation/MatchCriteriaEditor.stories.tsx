import React, { useState } from 'react';
import MatchCriteriaEditor from '../../components/evaluation/MatchCriteriaEditor';
import { FieldSet } from '@grafana/ui';

function MatchCriteriaEditorWrapper() {
  const [value, setValue] = useState<Record<string, string | string[]>>({
    agent_name: 'assistant-*',
    'model.provider': 'openai',
  });
  return (
    <FieldSet label="Match criteria">
      <MatchCriteriaEditor value={value} onChange={setValue} />
    </FieldSet>
  );
}

const meta = {
  title: 'Sigil/Evaluation/MatchCriteriaEditor',
  component: MatchCriteriaEditor,
};

export default meta;

export const Default = {
  render: () => <MatchCriteriaEditorWrapper />,
};

export const Empty = {
  args: {
    value: {},
    onChange: () => {},
  },
};

export const WithMultipleCriteria = {
  args: {
    value: {
      agent_name: 'assistant-*',
      'model.name': 'gpt-4o',
      mode: 'chat',
    },
    onChange: () => {},
  },
};
