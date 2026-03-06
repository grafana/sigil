import SummaryCards from '../../components/evaluation/SummaryCards';

const meta = {
  title: 'Sigil/Evaluation/SummaryCards',
  component: SummaryCards,
};

export default meta;

export const Default = {
  args: {
    activeRules: 5,
    disabledRules: 2,
    totalEvaluators: 12,
    predefinedTemplates: 8,
    onBrowseRules: () => {},
    onBrowseEvaluators: () => {},
    onBrowseTemplates: () => {},
  },
};

export const Empty = {
  args: {
    activeRules: 0,
    disabledRules: 0,
    totalEvaluators: 0,
    predefinedTemplates: 0,
    onBrowseRules: () => {},
    onBrowseEvaluators: () => {},
    onBrowseTemplates: () => {},
  },
};

export const Large = {
  args: {
    activeRules: 127,
    disabledRules: 24,
    totalEvaluators: 342,
    predefinedTemplates: 56,
    onBrowseRules: () => {},
    onBrowseEvaluators: () => {},
    onBrowseTemplates: () => {},
  },
};
