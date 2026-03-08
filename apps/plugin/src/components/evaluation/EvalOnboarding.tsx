import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, useStyles2, type IconName } from '@grafana/ui';

export type EvalOnboardingProps = {
  hasEvaluators: boolean;
  onGoToEvaluators: () => void;
  onGoToCreateRule: () => void;
};

const getStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;

  return {
    container: css({
      display: 'flex',
      flexDirection: 'column' as const,
      width: '100%',
      gap: theme.spacing(2),
    }),

    stepsContainer: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: theme.spacing(2),
      width: '100%',
    }),

    stepCard: css({
      position: 'relative' as const,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(1.5),
      padding: theme.spacing(2.25),
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
      '&:hover': {
        borderColor: theme.colors.border.medium,
        boxShadow: theme.shadows.z1,
        transform: 'translateY(-1px)',
      },
    }),

    stepCardActive: css({
      borderLeft: isDark ? '4px solid rgba(87, 148, 242, 0.78)' : '4px solid rgba(87, 148, 242, 0.82)',
      borderColor: isDark ? 'rgba(87, 148, 242, 0.22)' : 'rgba(87, 148, 242, 0.24)',
      '&:hover': {
        borderColor: isDark ? 'rgba(87, 148, 242, 0.3)' : 'rgba(87, 148, 242, 0.32)',
      },
    }),

    stepCardMuted: css({
      borderLeft: isDark ? '4px solid rgba(184, 119, 217, 0.42)' : '4px solid rgba(184, 119, 217, 0.5)',
      borderColor: isDark ? 'rgba(184, 119, 217, 0.16)' : 'rgba(184, 119, 217, 0.18)',
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
      lineHeight: 1.55,
      fontSize: theme.typography.bodySmall.fontSize,
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

type EvalTypeConfig = {
  icon: IconName;
  label: string;
};

const EVAL_TYPES: EvalTypeConfig[] = [
  { icon: 'brain', label: 'LLM Judge — use an LLM to score quality, relevance, safety' },
  { icon: 'brackets-curly', label: 'JSON Schema — validate structured output format' },
  { icon: 'code-branch', label: 'Regex — pattern-match on response content' },
  { icon: 'check-square', label: 'Heuristic — length checks, non-empty, custom rules' },
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
      <div className={styles.stepsContainer}>
        <div className={`${styles.stepCard} ${hasEvaluators ? '' : styles.stepCardActive}`}>
          <div className={styles.stepHeader}>
            <span className={`${styles.stepNumber} ${hasEvaluators ? styles.stepNumberDone : styles.stepNumberActive}`}>
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

        <div className={`${styles.stepCard} ${hasEvaluators ? styles.stepCardActive : styles.stepCardMuted}`}>
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
