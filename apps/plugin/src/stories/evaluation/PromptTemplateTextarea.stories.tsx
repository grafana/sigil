import React, { useState } from 'react';
import PromptTemplateTextarea from '../../components/evaluation/PromptTemplateTextarea';

const meta = {
  title: 'Sigil/Evaluation/PromptTemplateTextarea',
  component: PromptTemplateTextarea,
};

export default meta;

type StoryArgs = {
  initialValue: string;
  placeholder: string;
};

function Render(args: StoryArgs) {
  const [value, setValue] = useState(args.initialValue);

  return <PromptTemplateTextarea value={value} onChange={setValue} placeholder={args.placeholder} />;
}

export const UserPrompt = {
  render: Render,
  args: {
    initialValue: 'User input:\n{{input}}\n\nAssistant output:\n{{output}}\n\nConversation:\n{{conversation_id}}',
    placeholder: 'User input:\n{{input}}\n\nAssistant output:\n{{output}}',
  },
};

export const Empty = {
  render: Render,
  args: {
    initialValue: '',
    placeholder: 'You evaluate one assistant response.',
  },
};
