import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import EvalTabBar from '../../components/evaluation/EvalTabBar';

const meta = {
  title: 'Sigil/Evaluation/EvalTabBar',
  component: EvalTabBar,
  decorators: [
    (Story: React.ComponentType, context: { parameters: { initialPath?: string } }) => {
      const initialPath = context.parameters.initialPath ?? '/a/grafana-sigil-app/evaluation';
      return (
        <MemoryRouter initialEntries={[initialPath]}>
          <Story />
        </MemoryRouter>
      );
    },
  ],
};

export default meta;

export const Overview = {
  parameters: {
    initialPath: '/a/grafana-sigil-app/evaluation',
  },
};

export const Evaluators = {
  parameters: {
    initialPath: '/a/grafana-sigil-app/evaluation/evaluators',
  },
};

export const Rules = {
  parameters: {
    initialPath: '/a/grafana-sigil-app/evaluation/rules',
  },
};
