import React, { useCallback, useState } from 'react';
import { css, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, IconButton, Text, useStyles2, type IconName } from '@grafana/ui';

const STORAGE_KEY = 'sigil.eval.pipeline-banner-dismissed';

const pulseGlow = keyframes({
  '0%, 100%': { opacity: 0.5 },
  '50%': { opacity: 1 },
});

type PipelineStepConfig = {
  icon: IconName;
  label: string;
  styleKey: 'iconIngest' | 'iconEval' | 'iconScore' | 'iconDash';
};

const PIPELINE_STEPS: PipelineStepConfig[] = [
  { icon: 'database', label: 'LLM traffic', styleKey: 'iconIngest' },
  { icon: 'filter', label: 'Select & match', styleKey: 'iconDash' },
  { icon: 'check-circle', label: 'Evaluate', styleKey: 'iconEval' },
  { icon: 'graph-bar', label: 'Score & alert', styleKey: 'iconScore' },
];

function isDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const getStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;

  return {
    banner: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(5),
      padding: theme.spacing(2.5, 3),
      borderRadius: theme.shape.radius.default,
      background: isDark
        ? 'linear-gradient(135deg, rgba(61, 113, 217, 0.06), rgba(138, 109, 245, 0.06))'
        : 'linear-gradient(135deg, rgba(61, 113, 217, 0.04), rgba(138, 109, 245, 0.04))',
      border: `1px solid ${theme.colors.border.weak}`,
      position: 'relative' as const,
    }),

    left: css({
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.spacing(0.5),
      flex: 1,
      minWidth: 0,
    }),

    title: css({
      color: theme.colors.text.primary,
    }),

    pipeline: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      flexShrink: 0,
    }),

    node: css({
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),

    nodeIcon: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 36,
      height: 36,
      borderRadius: theme.shape.radius.default,
    }),

    nodeLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      whiteSpace: 'nowrap' as const,
    }),

    arrow: css({
      color: theme.colors.text.disabled,
      animation: `${pulseGlow} 2.5s ease-in-out infinite`,
    }),

    close: css({
      position: 'absolute' as const,
      top: theme.spacing(1),
      right: theme.spacing(1),
    }),

    iconIngest: css({
      background: isDark ? 'rgba(115, 191, 105, 0.12)' : 'rgba(115, 191, 105, 0.1)',
      color: 'rgb(115, 191, 105)',
    }),

    iconDash: css({
      background: isDark ? 'rgba(61, 113, 217, 0.12)' : 'rgba(61, 113, 217, 0.1)',
      color: 'rgb(61, 113, 217)',
    }),

    iconEval: css({
      background: isDark ? 'rgba(138, 109, 245, 0.12)' : 'rgba(138, 109, 245, 0.1)',
      color: 'rgb(138, 109, 245)',
    }),

    iconScore: css({
      background: isDark ? 'rgba(255, 152, 48, 0.12)' : 'rgba(255, 152, 48, 0.1)',
      color: 'rgb(255, 152, 48)',
    }),
  };
};

export default function EvalPipelineBanner() {
  const styles = useStyles2(getStyles);
  const [visible, setVisible] = useState(() => !isDismissed());

  const handleDismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // storage full or disabled
    }
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className={styles.banner}>
      <div className={styles.left}>
        <div className={styles.title}>
          <Text weight="medium">How evaluation works</Text>
        </div>
        <Text color="secondary" variant="bodySmall">
          Evaluators define how quality is measured. Rules wire them to your LLM traffic by selecting generations,
          applying match criteria and sampling, then running evaluators to score in real time.
        </Text>
      </div>
      <div className={styles.pipeline}>
        {PIPELINE_STEPS.map((step, i) => (
          <React.Fragment key={step.label}>
            {i > 0 && <Icon name="arrow-right" size="sm" className={styles.arrow} />}
            <div className={styles.node}>
              <div className={`${styles.nodeIcon} ${styles[step.styleKey]}`}>
                <Icon name={step.icon} size="lg" />
              </div>
              <span className={styles.nodeLabel}>{step.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
      <IconButton
        name="times"
        size="md"
        tooltip="Dismiss"
        className={styles.close}
        onClick={handleDismiss}
        aria-label="Dismiss banner"
      />
    </div>
  );
}
