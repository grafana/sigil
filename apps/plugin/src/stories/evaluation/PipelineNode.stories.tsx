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

export const TrackStop = {
  args: {
    kind: 'selector',
    label: 'User-visible turn',
    trackStop: true,
  },
};

export const TrackStopLongLabel = {
  args: {
    kind: 'match',
    label: 'agent_name: devex-go-openai-planner',
    trackStop: true,
  },
};

export const Cell = {
  args: {
    kind: 'selector',
    label: 'User-visible turn',
    cell: true,
  },
};

export const CellLongLabel = {
  args: {
    kind: 'match',
    label: 'agent_name: devex-go-openai-planner · +2',
    cell: true,
  },
};
