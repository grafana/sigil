import React from 'react';
import { useNavigate } from 'react-router-dom';
import { css, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Icon, Spinner, Text, useStyles2, type IconName } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import EvalOnboarding from '../components/evaluation/EvalOnboarding';
import SummaryCards from '../components/evaluation/SummaryCards';
import { pickLatestVersionPerEvaluator } from '../evaluation/utils';
import { useEvalRulesDataContext } from '../contexts/EvalRulesDataContext';

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;
const SIGIL_BAR_BLUE = '#5794F2';
const SIGIL_BAR_PURPLE = '#B877D9';
const SIGIL_BAR_PINK = '#E06BB6';
const SIGIL_BAR_ORANGE = '#FF9830';
const FLOW_CYCLE_SECONDS = 6;
const FLOW_STEP_DELAY_SECONDS = FLOW_CYCLE_SECONDS / 4;
const FLOW_CONNECTOR_OFFSET_SECONDS = 0.8;

const connectorSparkTravel = keyframes({
  '0%, 100%': { opacity: 0, transform: 'translate3d(0, -50%, 0) scale(0.75)' },
  '8%': { opacity: 0, transform: 'translate3d(0, -50%, 0) scale(0.78)' },
  '14%': { opacity: 1, transform: 'translate3d(0, -50%, 0) scale(1)' },
  '30%': { opacity: 0.95, transform: 'translate3d(24px, -50%, 0) scale(1)' },
  '38%': { opacity: 0, transform: 'translate3d(38px, -50%, 0) scale(0.7)' },
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
    background: theme.colors.background.secondary,
    boxShadow: 'none',
  }),
  infoHeader: css({
    position: 'relative' as const,
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.75),
  }),
  infoTitle: css({
    fontSize: '1.55rem',
    lineHeight: 1.14,
    '@media (min-width: 900px)': {
      fontSize: '2.05rem',
      lineHeight: 1.12,
    },
  }),
  infoDescription: css({
    fontSize: theme.typography.h6.fontSize,
    lineHeight: theme.typography.h6.lineHeight,
    '@media (min-width: 900px)': {
      fontSize: '1.02rem',
      lineHeight: 1.55,
    },
  }),
  glowPhrase: css({
    display: 'inline-block',
    fontSize: '1.02em',
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: theme.spacing(1.75),
    '@media (min-width: 900px)': {
      gap: theme.spacing(3),
    },
  }),
  infoStep: css({
    position: 'relative' as const,
    overflow: 'visible' as const,
    display: 'flex',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.75),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.isDark ? 'rgba(31, 38, 56, 0.5)' : 'rgba(255, 255, 255, 0.62)',
    backdropFilter: 'blur(6px) saturate(1.06)',
    WebkitBackdropFilter: 'blur(6px) saturate(1.06)',
    minWidth: 0,
    '& > *': {
      position: 'relative',
      zIndex: 1,
    },
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      borderTopLeftRadius: theme.shape.radius.default,
      borderTopRightRadius: theme.shape.radius.default,
      background: 'var(--sigil-step-accent)',
      opacity: 0.9,
    },
  }),
  infoStepAura: css({
    position: 'absolute' as const,
    inset: -1,
    borderRadius: theme.shape.radius.default,
    opacity: 0,
    pointerEvents: 'none' as const,
    animation: `${nodeChargePulse} ${FLOW_CYCLE_SECONDS}s ease-out infinite`,
    zIndex: 0,
  }),
  infoStepAuraSelect: css({
    boxShadow: theme.isDark
      ? '0 0 0 1px rgba(87, 148, 242, 0.18), 0 0 8px rgba(87, 148, 242, 0.06)'
      : '0 0 0 1px rgba(87, 148, 242, 0.12), 0 0 6px rgba(87, 148, 242, 0.05)',
  }),
  infoStepAuraEvaluate: css({
    boxShadow: theme.isDark
      ? '0 0 0 1px rgba(184, 119, 217, 0.18), 0 0 8px rgba(184, 119, 217, 0.06)'
      : '0 0 0 1px rgba(184, 119, 217, 0.12), 0 0 6px rgba(184, 119, 217, 0.05)',
  }),
  infoStepAuraStore: css({
    boxShadow: theme.isDark
      ? '0 0 0 1px rgba(224, 107, 182, 0.18), 0 0 8px rgba(224, 107, 182, 0.06)'
      : '0 0 0 1px rgba(224, 107, 182, 0.12), 0 0 6px rgba(224, 107, 182, 0.05)',
  }),
  infoStepAuraInspect: css({
    boxShadow: theme.isDark
      ? '0 0 0 1px rgba(255, 152, 48, 0.18), 0 0 8px rgba(255, 152, 48, 0.06)'
      : '0 0 0 1px rgba(255, 152, 48, 0.12), 0 0 6px rgba(255, 152, 48, 0.05)',
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
    background: 'var(--sigil-connector-gradient)',
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      borderRadius: 999,
      filter: 'blur(3px)',
      opacity: 0.14,
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
    opacity: 0,
    transform: 'translateY(-50%)',
    animation: `${connectorSparkTravel} ${FLOW_CYCLE_SECONDS}s linear infinite`,
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
    background: SIGIL_BAR_PINK,
    color: SIGIL_BAR_PINK,
  }),
  infoConnectorSparkInspect: css({
    background: SIGIL_BAR_ORANGE,
    color: SIGIL_BAR_ORANGE,
  }),
  infoStepIcon: css({
    position: 'relative' as const,
    flexShrink: 0,
    width: 32,
    height: 32,
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
    animation: `${runeFlicker} ${FLOW_CYCLE_SECONDS}s ease-out infinite`,
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
    background: SIGIL_BAR_PINK,
    color: SIGIL_BAR_PINK,
  }),
  infoStepRuneInspect: css({
    background: SIGIL_BAR_ORANGE,
    color: SIGIL_BAR_ORANGE,
  }),
  infoStepSelect: css({
    background: 'rgba(87, 148, 242, 0.12)',
    color: SIGIL_BAR_BLUE,
  }),
  infoStepEvaluate: css({
    background: 'rgba(184, 119, 217, 0.12)',
    color: SIGIL_BAR_PURPLE,
  }),
  infoStepStore: css({
    background: 'rgba(224, 107, 182, 0.12)',
    color: SIGIL_BAR_PINK,
  }),
  infoStepInspect: css({
    background: 'rgba(255, 152, 48, 0.12)',
    color: SIGIL_BAR_ORANGE,
  }),
  infoStepBody: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.625),
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

const STEP_ACCENT_BY_TONE: Record<(typeof EVALUATION_FLOW_STEPS)[number]['toneClass'], string> = {
  infoStepSelect: SIGIL_BAR_BLUE,
  infoStepEvaluate: SIGIL_BAR_PURPLE,
  infoStepStore: SIGIL_BAR_PINK,
  infoStepInspect: SIGIL_BAR_ORANGE,
};

const STEP_SHADOW_BY_TONE: Record<(typeof EVALUATION_FLOW_STEPS)[number]['toneClass'], string> = {
  infoStepSelect: '0 -6px 18px rgba(87, 148, 242, 0.11), 0 0 6px rgba(87, 148, 242, 0.05)',
  infoStepEvaluate: '0 -6px 18px rgba(184, 119, 217, 0.11), 0 0 6px rgba(184, 119, 217, 0.05)',
  infoStepStore: '0 -6px 18px rgba(224, 107, 182, 0.11), 0 0 6px rgba(224, 107, 182, 0.05)',
  infoStepInspect: '0 -6px 18px rgba(255, 152, 48, 0.11), 0 0 6px rgba(255, 152, 48, 0.05)',
};

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return hex;
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function EvaluationInfoPanel({ styles }: { styles: ReturnType<typeof getStyles> }) {
  return (
    <section className={styles.infoPanel} aria-label="How evaluation works">
      <div className={styles.infoHeader}>
        <div className={styles.infoTitle}>
          <Text element="h4" weight="medium">
            How Sigil evaluates your AI applications
          </Text>
        </div>
        <div className={styles.infoDescription}>
          <Text variant="body" color="secondary">
            Sigil evaluates LLM and agentic applications to capture{' '}
            <span className={styles.glowPhrase}>hidden behaviors</span>, turn them into signals, and surface insights
            directly in Grafana.
          </Text>
        </div>
      </div>
      <div className={styles.infoGrid}>
        {EVALUATION_FLOW_STEPS.map((step, index) => (
          <div
            key={step.title}
            className={styles.infoStep}
            style={
              {
                ['--sigil-step-accent' as string]: STEP_ACCENT_BY_TONE[step.toneClass],
                boxShadow: STEP_SHADOW_BY_TONE[step.toneClass],
              } as React.CSSProperties
            }
          >
            <span
              className={`${styles.infoStepAura} ${styles[STEP_AURA_CLASS_BY_TONE[step.toneClass]]}`}
              style={{ animationDelay: `${index * FLOW_STEP_DELAY_SECONDS}s` }}
              aria-hidden="true"
            />
            <div className={`${styles.infoStepIcon} ${styles[step.toneClass]}`}>
              <Icon name={step.icon} size="sm" />
              <span
                className={`${styles.infoStepRune} ${styles[STEP_RUNE_CLASS_BY_TONE[step.toneClass]]}`}
                style={{ animationDelay: `${index * FLOW_STEP_DELAY_SECONDS}s` }}
                aria-hidden="true"
              />
            </div>
            <div className={styles.infoStepBody}>
              <Text variant="body" weight="medium">
                {step.title}
              </Text>
              <Text variant="body" color="secondary">
                {step.description}
              </Text>
            </div>
            {index < EVALUATION_FLOW_STEPS.length - 1 && (
              <span className={styles.infoConnector} aria-hidden="true">
                <span
                  className={styles.infoConnectorLine}
                  style={
                    {
                      ['--sigil-connector-gradient' as string]: `linear-gradient(90deg, ${withAlpha(
                        STEP_ACCENT_BY_TONE[step.toneClass],
                        0.24
                      )} 0%, ${withAlpha(STEP_ACCENT_BY_TONE[EVALUATION_FLOW_STEPS[index + 1].toneClass], 0.18)} 100%)`,
                    } as React.CSSProperties
                  }
                />
                <span
                  className={`${styles.infoConnectorSpark} ${styles[CONNECTOR_TONE_CLASS_BY_STEP[step.toneClass]]}`}
                  style={{ animationDelay: `${index * FLOW_STEP_DELAY_SECONDS + FLOW_CONNECTOR_OFFSET_SECONDS}s` }}
                />
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function EvaluationOverviewPage() {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const { rules, evaluators, predefinedCount, loading, errorMessage, setErrorMessage } = useEvalRulesDataContext();

  const activeRuleCount = rules.filter((r) => r.enabled).length;
  const disabledRuleCount = rules.length - activeRuleCount;
  const tenantEvalCount = pickLatestVersionPerEvaluator(evaluators.filter((e) => !e.is_predefined)).length;
  const hasEvaluators = tenantEvalCount > 0;
  const isFirstTimeSetup = rules.length === 0 && !hasEvaluators;

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.loading}>
          <Spinner />
        </div>
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
      <EvaluationInfoPanel styles={styles} />
      {isFirstTimeSetup ? (
        <EvalOnboarding
          hasEvaluators={hasEvaluators}
          onGoToEvaluators={() => navigate(`${EVAL_BASE}/evaluators`)}
          onGoToCreateRule={() => navigate(`${EVAL_BASE}/rules/new`)}
        />
      ) : (
        <SummaryCards
          activeRules={activeRuleCount}
          disabledRules={disabledRuleCount}
          totalEvaluators={tenantEvalCount}
          predefinedTemplates={predefinedCount}
          onBrowseRules={() => navigate(`${EVAL_BASE}/rules`)}
          onBrowseEvaluators={() => navigate(`${EVAL_BASE}/evaluators`)}
          onBrowseTemplates={() => navigate(`${EVAL_BASE}/evaluators?template_view=cards`)}
        />
      )}
      {rules.length === 0 && hasEvaluators && (
        <EvalOnboarding
          hasEvaluators={hasEvaluators}
          onGoToEvaluators={() => navigate(`${EVAL_BASE}/evaluators`)}
          onGoToCreateRule={() => navigate(`${EVAL_BASE}/rules/new`)}
        />
      )}
    </div>
  );
}
