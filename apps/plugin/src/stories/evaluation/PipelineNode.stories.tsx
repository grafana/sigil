import PipelineNode from '../../components/evaluation/PipelineNode';

const meta = {
  title: 'Sigil/Evaluation/PipelineNode',
  component: PipelineNode,
};

export default meta;

export const Selector = {
  args: {
    kind: 'selector',
    label: 'User-visible turn',
  },
};

export const Match = {
  args: {
    kind: 'match',
    label: 'agent_name: assistant-*',
  },
};

export const Sample = {
  args: {
    kind: 'sample',
    label: '10%',
  },
};

export const Evaluator = {
  args: {
    kind: 'evaluator',
    label: 'prod.helpfulness.v1',
  },
};

export const WithDetail = {
  args: {
    kind: 'evaluator',
    label: 'prod.helpfulness.v1',
    detail: 'LLM Judge',
  },
};

export const Clickable = {
  args: {
    kind: 'selector',
    label: 'User-visible turn',
    onClick: () => {
      // Storybook interaction-only callback.
    },
  },
};
