import React from 'react';
import { AssistantMenu } from '../components/landing/AssistantMenu';

export default {
  title: 'Landing/AssistantMenu',
  component: AssistantMenu,
};

export const Default = {
  render: () => (
    <AssistantMenu
      questions={[
        'What additional information does Sigil contain?',
        'What is the structure of the Sigil database?',
        'How does Sigil telemetry differ from standard tracing data?',
      ]}
      onAsk={() => undefined}
    />
  ),
};
