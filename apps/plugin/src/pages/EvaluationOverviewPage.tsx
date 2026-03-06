import React from 'react';
import { useNavigate } from 'react-router-dom';
import { css, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Icon, Spinner, Text, useStyles2, type IconName } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import EvalOnboarding from '../components/evaluation/EvalOnboarding';
import SummaryCards from '../components/evaluation/SummaryCards';
import { useEvalRulesDataContext } from '../contexts/EvalRulesDataContext';

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;
const SIGIL_BAR_BLUE = '#5794F2';
const SIGIL_BAR_PURPLE = '#B877D9';
const SIGIL_BAR_ORANGE = '#FF9830';

const connectorSparkTravel = keyframes({
  '0%': { opacity: 0, transform: 'translate3d(0, -50%, 0) scale(0.75)' },
  '12%': { opacity: 1, transform: 'translate3d(0, -50%, 0) scale(1)' },
  '70%': { opacity: 0.9, transform: 'translate3d(28px, -50%, 0) scale(1)' },
  '100%': { opacity: 0, transform: 'translate3d(38px, -50%, 0) scale(0.7)' },
});

const nodeChargePulse = keyframes({
  '0%, 100%': { opacity: 0, transform: 'scale(0.985)' },
  '12%': { opacity: 0, transform: 'scale(0.99)' },
  '24%': { opacity: 0.9, transform: 'scale(1)' },
  '42%': { opacity: 0.55, transform: 'scale(1.01)' },
  '58%': { opacity: 0.12, transform: 'scale(1.005)' },
});

const runeFlicker = keyframes({
  '0%, 100%': { opacity: 0, transform: 'translate3d(0, 0, 0) scale(0.7) rotate(45deg)' },
  '18%': { opacity: 0, transform: 'translate3d(0, 0, 0) scale(0.8) rotate(45deg)' },
  '32%': { opacity: 1, transform: 'translate3d(0, -1px, 0) scale(1) rotate(45deg)' },
  '48%': { opacity: 0.55, transform: 'translate3d(1px, -3px, 0) scale(0.92) rotate(45deg)' },
  '62%': { opacity: 0, transform: 'translate3d(1px, -5px, 0) scale(0.75) rotate(45deg)' },
});

const textGradientShift = keyframes({
  '0%, 100%': { backgroundPosition: '0% 50%' },
  '50%': { backgroundPosition: '100% 50%' },
});

const textGlowPulse = keyframes({
  '0%': {
    filter: 'drop-shadow(0 0 4px rgba(87, 148, 242, 0.18)) drop-shadow(0 0 8px rgba(184, 119, 217, 0.14))',
  },
  '100%': {
    filter: 'drop-shadow(0 0 6px rgba(87, 148, 242, 0.24)) drop-shadow(0 0 12px rgba(255, 152, 48, 0.18))',
  },
});

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(2),
  }),
  infoPanel: css({
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    padding: theme.spacing(2.5),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.isDark
      ? `linear-gradient(135deg, rgba(87, 148, 242, 0.08), rgba(184, 119, 217, 0.08), rgba(255, 152, 48, 0.07))`
      : `linear-gradient(135deg, rgba(87, 148, 242, 0.05), rgba(184, 119, 217, 0.05), rgba(255, 152, 48, 0.045))`,
  }),
  infoHeader: css({
    position: 'relative' as const,
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  glowPhrase: css({
    display: 'inline-block',
    fontSize: '1.04em',
    fontWeight: theme.typography.fontWeightBold,
    background: `linear-gradient(45deg, ${SIGIL_BAR_BLUE}, ${SIGIL_BAR_PURPLE}, ${SIGIL_BAR_ORANGE}, ${SIGIL_BAR_PURPLE})`,
    backgroundSize: '300% 300%',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
    animation: `${textGradientShift} 15s ease-in-out infinite, ${textGlowPulse} 12s ease-in-out infinite alternate`,
  }),
  infoGrid: css({
    position: 'relative' as const,
    zIndex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: theme.spacing(1.5),
    '@media (min-width: 900px)': {
      gap: theme.spacing(2.75),
    },
  }),
  infoStep: css({
    position: 'relative' as const,
    overflow: 'visible' as const,
    display: 'flex',
    gap: theme.spacing(1.25),
    padding: theme.spacing(1.5),
    borderRadius: theme.shape.radius.default,
    border: theme.isDark ? '1px solid rgba(255, 255, 255, 0.08)' : `1px solid rgba(87, 148, 242, 0.12)`,
    background: theme.isDark
      ? 'linear-gradient(180deg, rgba(28, 22, 36, 0.78), rgba(24, 20, 31, 0.72))'
      : 'linear-gradient(180deg, rgba(255, 250, 253, 0.96), rgba(249, 244, 249, 0.94))',
    boxShadow: theme.isDark
      ? '0 10px 24px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.03)'
      : '0 8px 20px rgba(87, 148, 242, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.6)',
    backdropFilter: 'blur(10px)',
    minWidth: 0,
  }),
  infoStepAura: css({
    position: 'absolute' as const,
    inset: -1,
    borderRadius: theme.shape.radius.default,
    opacity: 0,
    pointerEvents: 'none' as const,
    animation: `${nodeChargePulse} 5.2s ease-out infinite`,
    zIndex: -1,
  }),
  infoStepAuraSelect: css({
    boxShadow: theme.isDark
      ? '0 0 0 1px rgba(87, 148, 242, 0.24), 0 0 12px rgba(87, 148, 242, 0.1)'
      : '0 0 0 1px rgba(87, 148, 242, 0.16), 0 0 10px rgba(87, 148, 242, 0.08)',
    background: theme.isDark ? 'rgba(87, 148, 242, 0.04)' : 'rgba(87, 148, 242, 0.025)',
  }),
  infoStepAuraEvaluate: css({
    boxShadow: theme.isDark
      ? '0 0 0 1px rgba(184, 119, 217, 0.24), 0 0 12px rgba(184, 119, 217, 0.1)'
      : '0 0 0 1px rgba(184, 119, 217, 0.16), 0 0 10px rgba(184, 119, 217, 0.08)',
    background: theme.isDark ? 'rgba(184, 119, 217, 0.04)' : 'rgba(184, 119, 217, 0.025)',
  }),
  infoStepAuraStore: css({
    boxShadow: theme.isDark
      ? '0 0 0 1px rgba(255, 152, 48, 0.22), 0 0 10px rgba(255, 152, 48, 0.09)'
      : '0 0 0 1px rgba(255, 152, 48, 0.15), 0 0 8px rgba(255, 152, 48, 0.07)',
    background: theme.isDark ? 'rgba(255, 152, 48, 0.035)' : 'rgba(255, 152, 48, 0.02)',
  }),
  infoStepAuraInspect: css({
    boxShadow: theme.isDark
      ? '0 0 0 1px rgba(255, 152, 48, 0.22), 0 0 10px rgba(255, 152, 48, 0.09)'
      : '0 0 0 1px rgba(255, 152, 48, 0.15), 0 0 8px rgba(255, 152, 48, 0.07)',
    background: theme.isDark ? 'rgba(255, 152, 48, 0.035)' : 'rgba(255, 152, 48, 0.02)',
  }),
  infoConnector: css({
    display: 'none',
    '@media (min-width: 900px)': {
      display: 'block',
      position: 'absolute' as const,
      top: '50%',
      right: '-38px',
      width: 52,
      height: 28,
      pointerEvents: 'none' as const,
      transform: 'translateY(-50%)',
      zIndex: 3,
    },
  }),
  infoConnectorLine: css({
    position: 'absolute' as const,
    top: '50%',
    left: 0,
    width: '100%',
    height: 2,
    borderRadius: 999,
    transform: 'translateY(-50%)',
    background: theme.isDark
      ? 'linear-gradient(90deg, rgba(87, 148, 242, 0.22), rgba(184, 119, 217, 0.26), rgba(255, 152, 48, 0.18))'
      : 'linear-gradient(90deg, rgba(87, 148, 242, 0.18), rgba(184, 119, 217, 0.22), rgba(255, 152, 48, 0.14))',
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      borderRadius: 999,
      filter: 'blur(3px)',
      opacity: 0.25,
      background: 'inherit',
    },
  }),
  infoConnectorSpark: css({
    position: 'absolute' as const,
    top: '50%',
    left: 0,
    width: 6,
    height: 6,
    borderRadius: 999,
    transform: 'translateY(-50%)',
    animation: `${connectorSparkTravel} 5.2s ease-out infinite`,
    boxShadow: '0 0 6px currentColor',
    zIndex: 1,
  }),
  infoConnectorSparkSelect: css({
    background: SIGIL_BAR_BLUE,
    color: SIGIL_BAR_BLUE,
  }),
  infoConnectorSparkEvaluate: css({
    background: SIGIL_BAR_PURPLE,
    color: SIGIL_BAR_PURPLE,
  }),
  infoConnectorSparkStore: css({
    background: SIGIL_BAR_ORANGE,
    color: SIGIL_BAR_ORANGE,
  }),
  infoConnectorSparkInspect: css({
    background: SIGIL_BAR_ORANGE,
    color: SIGIL_BAR_ORANGE,
  }),
  infoStepIcon: css({
    position: 'relative' as const,
    flexShrink: 0,
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.shape.radius.default,
  }),
  infoStepRune: css({
    position: 'absolute' as const,
    top: -4,
    right: -4,
    width: 6,
    height: 6,
    borderRadius: 1,
    transform: 'rotate(45deg)',
    opacity: 0,
    animation: `${runeFlicker} 5.2s ease-out infinite`,
    pointerEvents: 'none' as const,
    boxShadow: '0 0 5px currentColor',
  }),
  infoStepRuneSelect: css({
    background: SIGIL_BAR_BLUE,
    color: SIGIL_BAR_BLUE,
  }),
  infoStepRuneEvaluate: css({
    background: SIGIL_BAR_PURPLE,
    color: SIGIL_BAR_PURPLE,
  }),
  infoStepRuneStore: css({
    background: SIGIL_BAR_ORANGE,
    color: SIGIL_BAR_ORANGE,
  }),
  infoStepRuneInspect: css({
    background: SIGIL_BAR_ORANGE,
    color: SIGIL_BAR_ORANGE,
  }),
  infoStepSelect: css({
    background: theme.isDark ? 'rgba(87, 148, 242, 0.12)' : 'rgba(87, 148, 242, 0.1)',
    color: SIGIL_BAR_BLUE,
  }),
  infoStepEvaluate: css({
    background: theme.isDark ? 'rgba(184, 119, 217, 0.12)' : 'rgba(184, 119, 217, 0.1)',
    color: SIGIL_BAR_PURPLE,
  }),
  infoStepStore: css({
    background: theme.isDark ? 'rgba(255, 152, 48, 0.12)' : 'rgba(255, 152, 48, 0.1)',
    color: SIGIL_BAR_ORANGE,
  }),
  infoStepInspect: css({
    background: theme.isDark ? 'rgba(255, 152, 48, 0.12)' : 'rgba(255, 152, 48, 0.1)',
    color: SIGIL_BAR_ORANGE,
  }),
  infoStepBody: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
    minWidth: 0,
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
  }),
});

const EVALUATION_FLOW_STEPS: Array<{
  icon: IconName;
  title: string;
  description: string;
  toneClass: 'infoStepSelect' | 'infoStepEvaluate' | 'infoStepStore' | 'infoStepInspect';
}> = [
  {
    icon: 'filter',
    title: 'Define rules',
    description: 'Choose which assistant and agentic traffic to evaluate.',
    toneClass: 'infoStepSelect',
  },
  {
    icon: 'check-circle',
    title: 'Run evaluators',
    description: 'LLM judges, regex, schema, and heuristics score responses automatically.',
    toneClass: 'infoStepEvaluate',
  },
  {
    icon: 'database',
    title: 'Store results',
    description: 'Scores are written back into Grafana for exploration and debugging.',
    toneClass: 'infoStepStore',
  },
  {
    icon: 'graph-bar',
    title: 'Act on signals',
    description: 'Use dashboards and alerts to improve quality over time.',
    toneClass: 'infoStepInspect',
  },
];

const CONNECTOR_TONE_CLASS_BY_STEP: Record<
  (typeof EVALUATION_FLOW_STEPS)[number]['toneClass'],
  'infoConnectorSparkSelect' | 'infoConnectorSparkEvaluate' | 'infoConnectorSparkStore' | 'infoConnectorSparkInspect'
> = {
  infoStepSelect: 'infoConnectorSparkSelect',
  infoStepEvaluate: 'infoConnectorSparkEvaluate',
  infoStepStore: 'infoConnectorSparkStore',
  infoStepInspect: 'infoConnectorSparkInspect',
};

const STEP_AURA_CLASS_BY_TONE: Record<
  (typeof EVALUATION_FLOW_STEPS)[number]['toneClass'],
  'infoStepAuraSelect' | 'infoStepAuraEvaluate' | 'infoStepAuraStore' | 'infoStepAuraInspect'
> = {
  infoStepSelect: 'infoStepAuraSelect',
  infoStepEvaluate: 'infoStepAuraEvaluate',
  infoStepStore: 'infoStepAuraStore',
  infoStepInspect: 'infoStepAuraInspect',
};

const STEP_RUNE_CLASS_BY_TONE: Record<
  (typeof EVALUATION_FLOW_STEPS)[number]['toneClass'],
  'infoStepRuneSelect' | 'infoStepRuneEvaluate' | 'infoStepRuneStore' | 'infoStepRuneInspect'
> = {
  infoStepSelect: 'infoStepRuneSelect',
  infoStepEvaluate: 'infoStepRuneEvaluate',
  infoStepStore: 'infoStepRuneStore',
  infoStepInspect: 'infoStepRuneInspect',
};

export default function EvaluationOverviewPage() {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const { rules, evaluators, predefinedCount, loading, errorMessage, setErrorMessage } = useEvalRulesDataContext();

  const activeRuleCount = rules.filter((r) => r.enabled).length;
  const disabledRuleCount = rules.length - activeRuleCount;
  const tenantEvalCount = evaluators.filter((e) => !e.is_predefined).length;
  const hasEvaluators = tenantEvalCount > 0;

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className={styles.pageContainer}>
        {errorMessage.length > 0 && (
          <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
            <Text>{errorMessage}</Text>
          </Alert>
        )}
        <EvalOnboarding
          hasEvaluators={hasEvaluators}
          onGoToEvaluators={() => navigate(`${EVAL_BASE}/evaluators`)}
          onGoToCreateRule={() => navigate(`${EVAL_BASE}/rules/new`)}
        />
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}
      <section className={styles.infoPanel} aria-label="How evaluation works">
        <div className={styles.infoHeader}>
          <Text element="h4" weight="medium">
            How Sigil evaluates your AI applications
          </Text>
          <Text variant="body" color="secondary">
            Sigil evaluates LLM and agentic systems to capture{' '}
            <span className={styles.glowPhrase}>hidden behaviors</span>, turn them into signals, and surface insights
            about your AI applications directly in Grafana.
          </Text>
        </div>
        <div className={styles.infoGrid}>
          {EVALUATION_FLOW_STEPS.map((step, index) => (
            <div key={step.title} className={styles.infoStep}>
              <span
                className={`${styles.infoStepAura} ${styles[STEP_AURA_CLASS_BY_TONE[step.toneClass]]}`}
                style={{ animationDelay: `${index * 0.8}s` }}
                aria-hidden="true"
              />
              <div className={`${styles.infoStepIcon} ${styles[step.toneClass]}`}>
                <Icon name={step.icon} size="sm" />
                <span
                  className={`${styles.infoStepRune} ${styles[STEP_RUNE_CLASS_BY_TONE[step.toneClass]]}`}
                  style={{ animationDelay: `${index * 0.8}s` }}
                  aria-hidden="true"
                />
              </div>
              <div className={styles.infoStepBody}>
                <Text variant="bodySmall" weight="medium">
                  {step.title}
                </Text>
                <Text variant="bodySmall" color="secondary">
                  {step.description}
                </Text>
              </div>
              {index < EVALUATION_FLOW_STEPS.length - 1 && (
                <span className={styles.infoConnector} aria-hidden="true">
                  <span className={styles.infoConnectorLine} />
                  <span
                    className={`${styles.infoConnectorSpark} ${styles[CONNECTOR_TONE_CLASS_BY_STEP[step.toneClass]]}`}
                    style={{ animationDelay: `${index * 0.8}s` }}
                  />
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <SummaryCards
        activeRules={activeRuleCount}
        disabledRules={disabledRuleCount}
        totalEvaluators={tenantEvalCount}
        predefinedTemplates={predefinedCount}
        onBrowseRules={() => navigate(`${EVAL_BASE}/rules`)}
        onBrowseEvaluators={() => navigate(`${EVAL_BASE}/evaluators`)}
        onBrowseTemplates={() => navigate(`${EVAL_BASE}/evaluators?template_view=cards`)}
      />
    </div>
  );
}
