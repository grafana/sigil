import EvalOnboarding from '../../components/evaluation/EvalOnboarding';

const meta = {
  title: 'Sigil/Evaluation/EvalOnboarding',
  component: EvalOnboarding,
};

export default meta;

export const NoEvaluators = {
  args: {
    hasEvaluators: false,
    onGoToEvaluators: () => {},
    onGoToCreateRule: () => {},
  },
};

export const HasEvaluators = {
  args: {
    hasEvaluators: true,
    onGoToEvaluators: () => {},
    onGoToCreateRule: () => {},
  },
};
