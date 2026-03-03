import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { GenerationDetail } from '../../conversation/types';
import ChatPreview from './ChatPreview';

export type GenerationItemProps = {
  generation: GenerationDetail;
  index: number;
};

function formatUsageValue(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toLocaleString();
}

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    label: 'generationItem-card',
    display: 'grid',
    gap: theme.spacing(0.75),
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  cardTitle: css({
    label: 'generationItem-cardTitle',
    margin: 0,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    overflowWrap: 'anywhere' as const,
  }),
  cardBody: css({
    label: 'generationItem-cardBody',
    display: 'grid',
    gap: theme.spacing(1),
    gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)',
    alignItems: 'start',
    [`@media (max-width: ${theme.breakpoints.values.md}px)`]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  }),
  metaColumn: css({
    label: 'generationItem-metaColumn',
    display: 'grid',
    gap: theme.spacing(0.75),
  }),
  metaGrid: css({
    label: 'generationItem-metaGrid',
    display: 'grid',
    gap: theme.spacing(0.5),
    gridTemplateColumns: 'minmax(0, 1fr)',
  }),
  metaRow: css({
    label: 'generationItem-metaRow',
    display: 'grid',
    gridTemplateColumns: 'minmax(96px, 120px) minmax(0, 1fr)',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    overflowWrap: 'anywhere' as const,
  }),
  label: css({
    label: 'generationItem-label',
    color: theme.colors.text.secondary,
  }),
  value: css({
    label: 'generationItem-value',
    color: theme.colors.text.primary,
  }),
  chatColumn: css({
    label: 'generationItem-chatColumn',
    display: 'grid',
    gap: theme.spacing(0.5),
  }),
});

export default function GenerationItem({ generation, index }: GenerationItemProps) {
  const styles = useStyles2(getStyles);

  return (
    <article className={styles.card}>
      <h4 className={styles.cardTitle}>
        {index + 1}. {generation.generation_id}
      </h4>
      <div className={styles.cardBody}>
        <div className={styles.metaColumn}>
          <div className={styles.metaGrid}>
            <div className={styles.metaRow}>
              <span className={styles.label}>Created</span>
              <span className={styles.value}>{generation.created_at ?? 'n/a'}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.label}>Model</span>
              <span className={styles.value}>
                {generation.model?.provider ?? 'unknown-provider'} / {generation.model?.name ?? 'unknown-model'}
              </span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.label}>Mode</span>
              <span className={styles.value}>{generation.mode ?? 'n/a'}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.label}>Trace ID</span>
              <span className={styles.value}>{generation.trace_id ?? 'n/a'}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.label}>Input tokens</span>
              <span className={styles.value}>{formatUsageValue(generation.usage?.input_tokens)}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.label}>Output tokens</span>
              <span className={styles.value}>{formatUsageValue(generation.usage?.output_tokens)}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.label}>Total tokens</span>
              <span className={styles.value}>{formatUsageValue(generation.usage?.total_tokens)}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.label}>Error</span>
              <span className={styles.value}>{generation.error?.message ?? 'none'}</span>
            </div>
          </div>
        </div>

        <div className={styles.chatColumn}>
          <ChatPreview generationID={generation.generation_id} input={generation.input} output={generation.output} />
        </div>
      </div>
    </article>
  );
}
