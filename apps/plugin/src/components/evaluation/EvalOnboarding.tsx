import React from 'react';
import { css, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, Text, useStyles2, type IconName } from '@grafana/ui';

export type EvalOnboardingProps = {
  hasEvaluators: boolean;
  onGoToEvaluators: () => void;
  onGoToCreateRule: () => void;
};

const pulseGlow = keyframes({
  '0%, 100%': { opacity: 0.6 },
  '50%': { opacity: 1 },
});

const getStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;

  return {
    container: css({
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: theme.spacing(5),
      padding: theme.spacing(6, 2),
      maxWidth: 860,
      margin: '0 auto',
    }),

    heroSection: css({
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: theme.spacing(2),
      textAlign: 'center' as const,
    }),

    heroTitle: css({
      fontSize: theme.typography.h3.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.3,
    }),

    heroSubtitle: css({
      maxWidth: 520,
      color: theme.colors.text.secondary,
      lineHeight: 1.6,
    }),

    pipelineVisual: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      padding: theme.spacing(3, 4),
      borderRadius: theme.shape.radius.default,
      background: isDark
        ? 'linear-gradient(135deg, rgba(61, 113, 217, 0.06), rgba(138, 109, 245, 0.06))'
        : 'linear-gradient(135deg, rgba(61, 113, 217, 0.04), rgba(138, 109, 245, 0.04))',
      border: `1px solid ${theme.colors.border.weak}`,
    }),

    pipelineNode: css({
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: theme.spacing(0.75),
    }),

    pipelineIcon: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 48,
      height: 48,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      transition: 'all 0.2s',
    }),

    pipelineIconIngest: css({
      background: isDark ? 'rgba(115, 191, 105, 0.1)' : 'rgba(115, 191, 105, 0.08)',
      color: 'rgb(115, 191, 105)',
    }),

    pipelineIconEval: css({
      background: isDark ? 'rgba(138, 109, 245, 0.1)' : 'rgba(138, 109, 245, 0.08)',
      color: 'rgb(138, 109, 245)',
    }),

    pipelineIconScore: css({
      background: isDark ? 'rgba(255, 152, 48, 0.1)' : 'rgba(255, 152, 48, 0.08)',
      color: 'rgb(255, 152, 48)',
    }),

    pipelineIconDash: css({
      background: isDark ? 'rgba(61, 113, 217, 0.1)' : 'rgba(61, 113, 217, 0.08)',
      color: 'rgb(61, 113, 217)',
    }),

    pipelineLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      whiteSpace: 'nowrap' as const,
    }),

    pipelineArrow: css({
      color: theme.colors.text.disabled,
      animation: `${pulseGlow} 2s ease-in-out infinite`,
    }),

    stepsContainer: css({
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: theme.spacing(3),
      width: '100%',
    }),

    stepCard: css({
      position: 'relative' as const,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(2),
      padding: theme.spacing(3),
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      transition: 'border-color 0.2s, box-shadow 0.2s',
      '&:hover': {
        borderColor: theme.colors.border.medium,
        boxShadow: theme.shadows.z1,
      },
    }),

    stepCardActive: css({
      borderColor: theme.colors.primary.border,
      '&:hover': {
        borderColor: theme.colors.primary.border,
      },
    }),

    stepCardMuted: css({
      opacity: 0.6,
    }),

    stepNumber: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      borderRadius: '50%',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      flexShrink: 0,
    }),

    stepNumberActive: css({
      background: isDark
        ? 'linear-gradient(135deg, rgba(61, 113, 217, 0.25), rgba(138, 109, 245, 0.25))'
        : 'linear-gradient(135deg, rgba(61, 113, 217, 0.15), rgba(138, 109, 245, 0.15))',
      color: theme.colors.primary.text,
    }),

    stepNumberDone: css({
      background: isDark ? 'rgba(115, 191, 105, 0.2)' : 'rgba(115, 191, 105, 0.15)',
      color: 'rgb(115, 191, 105)',
    }),

    stepNumberPending: css({
      background: theme.colors.background.secondary,
      color: theme.colors.text.disabled,
    }),

    stepHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
    }),

    stepTitle: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),

    stepDescription: css({
      color: theme.colors.text.secondary,
      lineHeight: 1.6,
      fontSize: theme.typography.body.fontSize,
    }),

    stepFeatures: css({
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(1),
      marginTop: theme.spacing(0.5),
    }),

    stepFeature: css({
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(1),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.5,
    }),

    featureIcon: css({
      flexShrink: 0,
      marginTop: 2,
      color: theme.colors.text.disabled,
    }),

    stepFooter: css({
      marginTop: 'auto',
      paddingTop: theme.spacing(1),
    }),
  };
};

type PipelineStepConfig = {
  icon: IconName;
  label: string;
  styleKey: 'pipelineIconIngest' | 'pipelineIconEval' | 'pipelineIconScore' | 'pipelineIconDash';
};

const PIPELINE_STEPS: PipelineStepConfig[] = [
  { icon: 'database', label: 'LLM traffic', styleKey: 'pipelineIconIngest' },
  { icon: 'filter', label: 'Select & match', styleKey: 'pipelineIconDash' },
  { icon: 'check-circle', label: 'Evaluate', styleKey: 'pipelineIconEval' },
  { icon: 'graph-bar', label: 'Score & alert', styleKey: 'pipelineIconScore' },
];

type EvalTypeConfig = {
  icon: IconName;
  label: string;
};

const EVAL_TYPES: EvalTypeConfig[] = [
  { icon: 'brain', label: 'LLM Judge -- use an LLM to score quality, relevance, safety' },
  { icon: 'brackets-curly', label: 'JSON Schema -- validate structured output format' },
  { icon: 'code-branch', label: 'Regex -- pattern-match on response content' },
  { icon: 'check-square', label: 'Heuristic -- length checks, non-empty, custom rules' },
];

type RuleFeatureConfig = {
  icon: IconName;
  label: string;
};

const RULE_FEATURES: RuleFeatureConfig[] = [
  { icon: 'filter', label: 'Selectors pick which generations to evaluate' },
  { icon: 'search', label: 'Match criteria filter by model, provider, or metadata' },
  { icon: 'percentage', label: 'Sample rate controls evaluation volume' },
  { icon: 'check-circle', label: 'Attach one or more evaluators to run automatically' },
];

export default function EvalOnboarding({ hasEvaluators, onGoToEvaluators, onGoToCreateRule }: EvalOnboardingProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.container}>
      <div className={styles.heroSection}>
        <div className={styles.pipelineVisual}>
          {PIPELINE_STEPS.map((step, i) => (
            <React.Fragment key={step.label}>
              {i > 0 && <Icon name="arrow-right" size="md" className={styles.pipelineArrow} />}
              <div className={styles.pipelineNode}>
                <div className={`${styles.pipelineIcon} ${styles[step.styleKey]}`}>
                  <Icon name={step.icon} size="xl" />
                </div>
                <span className={styles.pipelineLabel}>{step.label}</span>
              </div>
            </React.Fragment>
          ))}
        </div>
        <h3 className={styles.heroTitle}>Automated evaluation for your LLM&nbsp;pipeline</h3>
        <div className={styles.heroSubtitle}>
          <Text color="secondary">
            Score every generation in real time. Set up evaluators to define how quality is measured, then create rules
            to connect them to your traffic.
          </Text>
        </div>
      </div>

      <div className={styles.stepsContainer}>
        <div className={`${styles.stepCard} ${hasEvaluators ? '' : styles.stepCardActive}`}>
          <div className={styles.stepHeader}>
            <span
              className={`${styles.stepNumber} ${hasEvaluators ? styles.stepNumberDone : styles.stepNumberActive}`}
            >
              {hasEvaluators ? <Icon name="check" size="sm" /> : '1'}
            </span>
            <span className={styles.stepTitle}>Set up evaluators</span>
          </div>
          <div className={styles.stepDescription}>
            Evaluators define how each generation is scored. Choose from built-in templates or create your own.
          </div>
          <div className={styles.stepFeatures}>
            {EVAL_TYPES.map((et) => (
              <div key={et.label} className={styles.stepFeature}>
                <Icon name={et.icon} size="sm" className={styles.featureIcon} />
                <span>{et.label}</span>
              </div>
            ))}
          </div>
          <div className={styles.stepFooter}>
            <Button
              variant={hasEvaluators ? 'secondary' : 'primary'}
              icon={hasEvaluators ? 'pen' : 'plus'}
              onClick={onGoToEvaluators}
            >
              {hasEvaluators ? 'Manage evaluators' : 'Browse evaluators'}
            </Button>
          </div>
        </div>

        <div
          className={`${styles.stepCard} ${hasEvaluators ? styles.stepCardActive : styles.stepCardMuted}`}
        >
          <div className={styles.stepHeader}>
            <span
              className={`${styles.stepNumber} ${hasEvaluators ? styles.stepNumberActive : styles.stepNumberPending}`}
            >
              2
            </span>
            <span className={styles.stepTitle}>Create rules</span>
          </div>
          <div className={styles.stepDescription}>
            Rules wire evaluators to your LLM traffic. Select which generations to evaluate, filter by metadata, set a
            sample rate, and attach evaluators.
          </div>
          <div className={styles.stepFeatures}>
            {RULE_FEATURES.map((rf) => (
              <div key={rf.label} className={styles.stepFeature}>
                <Icon name={rf.icon} size="sm" className={styles.featureIcon} />
                <span>{rf.label}</span>
              </div>
            ))}
          </div>
          <div className={styles.stepFooter}>
            <Button
              variant={hasEvaluators ? 'primary' : 'secondary'}
              icon="plus"
              onClick={onGoToCreateRule}
              disabled={!hasEvaluators}
              tooltip={!hasEvaluators ? 'Set up at least one evaluator first' : undefined}
            >
              Create your first rule
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
