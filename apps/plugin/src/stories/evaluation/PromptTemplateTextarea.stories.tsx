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
    initialValue:
      'Latest user message:\n{{input}}\n\nAssistant response:\n{{output}}\n\nTool calls:\n{{tool_calls}}\n\nCall error:\n{{call_error}}',
    placeholder: 'Latest user message:\n{{input}}\n\nAssistant response:\n{{output}}',
  },
};

export const Empty = {
  render: Render,
  args: {
    initialValue: '',
    placeholder: 'You evaluate one assistant response.',
  },
};

export const MixedTemplateVars = {
  render: Render,
  args: {
    initialValue:
      'You are a rigorous evaluator.\n\nLatest user message: {{latest_user_message}}\nAssistant sequence:\n{{assistant_sequence}}\n\nTools:\n{{tools}}',
    placeholder: 'Conversation ID: {{conversation_id}}',
  },
};
