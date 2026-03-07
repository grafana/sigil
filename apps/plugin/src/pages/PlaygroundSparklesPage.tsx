import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { SparklesBackground } from '../components/landing/SparklesBackground';

export default function PlaygroundSparklesPage() {
  const styles = useStyles2(getStyles);
  const search = new URLSearchParams(window.location.search);
  const text = search.get('text')?.trim() || 'Sparkles playground';

  return (
    <div className={styles.page}>
      <SparklesBackground className={styles.sparklesLayer} withGradient />
      <div className={styles.centerText}>{text}</div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    page: css({
      position: 'relative',
      width: '100%',
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
      borderRadius: 0,
    }),
    sparklesLayer: css({
      position: 'absolute',
      inset: 0,
      zIndex: 1,
    }),
    centerText: css({
      position: 'absolute',
      inset: 0,
      zIndex: 2,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center' as const,
      pointerEvents: 'none',
      padding: theme.spacing(2),
      color: theme.colors.text.primary,
      fontSize: theme.typography.h2.fontSize,
      lineHeight: theme.typography.h2.lineHeight,
      fontWeight: theme.typography.fontWeightMedium,
      textShadow: `0 0 24px ${theme.colors.background.primary}`,
      wordBreak: 'break-word' as const,
    }),
  };
}
