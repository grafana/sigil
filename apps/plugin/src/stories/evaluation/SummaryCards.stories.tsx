import SummaryCards from '../../components/evaluation/SummaryCards';

const meta = {
  title: 'Sigil/Evaluation/SummaryCards',
  component: SummaryCards,
};

export default meta;

export const Default = {
  args: {
    activeRules: 5,
    totalEvaluators: 12,
    predefinedTemplates: 8,
    onCreateRule: () => {},
    onBrowseEvaluators: () => {},
  },
};

export const Empty = {
  args: {
    activeRules: 0,
    totalEvaluators: 0,
    predefinedTemplates: 0,
    onCreateRule: () => {},
    onBrowseEvaluators: () => {},
  },
};

export const Large = {
  args: {
    activeRules: 127,
    totalEvaluators: 342,
    predefinedTemplates: 56,
    onCreateRule: () => {},
    onBrowseEvaluators: () => {},
  },
};
