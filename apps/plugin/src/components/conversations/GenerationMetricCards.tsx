import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { GenerationMetrics } from './generationMetrics';

export type GenerationMetricCardsProps = {
  metrics: GenerationMetrics;
};

const getStyles = (theme: GrafanaTheme2) => ({
  cards: css({
    label: 'generationMetricCards-cards',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: theme.spacing(1),
    minWidth: 0,
  }),
  card: css({
    label: 'generationMetricCards-card',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    padding: theme.spacing(1),
    minWidth: 0,
  }),
  label: css({
    label: 'generationMetricCards-label',
    display: 'block',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.2,
    marginBottom: theme.spacing(0.25),
  }),
  value: css({
    label: 'generationMetricCards-value',
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    fontVariantNumeric: 'tabular-nums',
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  }),
});

export default function GenerationMetricCards({ metrics }: GenerationMetricCardsProps) {
  const styles = useStyles2(getStyles);
  const items = [
    { label: 'Token', value: metrics.tokenDisplay },
    { label: 'Cost', value: metrics.costDisplay },
    { label: 'Latency', value: metrics.latencyDisplay },
  ];

  return (
    <div className={styles.cards} aria-label="Generation metric cards">
      {items.map((item) => (
        <div key={item.label} className={styles.card}>
          <span className={styles.label}>{item.label}</span>
          <span className={styles.value}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
