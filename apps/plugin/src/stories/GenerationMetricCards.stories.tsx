import GenerationMetricCards from '../components/conversations/GenerationMetricCards';

const meta = {
  title: 'Sigil/Conversations/GenerationMetricCards',
  component: GenerationMetricCards,
};

export default meta;

export const Default = {
  args: {
    metrics: {
      tokenDisplay: '1,024',
      costDisplay: '$0.1240',
      latencyDisplay: '842 ms',
    },
  },
};

export const MissingValues = {
  args: {
    metrics: {
      tokenDisplay: '—',
      costDisplay: '—',
      latencyDisplay: '—',
    },
  },
};
