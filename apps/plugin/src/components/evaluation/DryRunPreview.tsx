import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Spinner, Text, useStyles2 } from '@grafana/ui';
import type { RulePreviewResponse } from '../../evaluation/types';
import DryRunGenerationRow from './DryRunGenerationRow';

export type DryRunPreviewProps = {
  preview: RulePreviewResponse | null;
  loading: boolean;
  onAddMatchCriteria?: (key: string, value: string) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    maxHeight: 750,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    background: theme.colors.background.primary,
    boxShadow: theme.shadows.z1,
    borderRadius: '6px',
  }),
  header: css({
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    padding: theme.spacing(2),
    borderBottom: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
  }),
  headerTitle: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  statsGrid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: theme.spacing(1),
  }),
  statItem: css({
    padding: theme.spacing(1, 1.5),
    borderRadius: theme.shape.radius.sm,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  statValue: css({
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    color: theme.colors.text.primary,
    lineHeight: 1.2,
  }),
  statLabel: css({
    marginTop: theme.spacing(0.25),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  list: css({
    maxHeight: 510,
    overflowY: 'auto' as const,
  }),
  empty: css({
    padding: theme.spacing(4),
    textAlign: 'center' as const,
    color: theme.colors.text.secondary,
  }),
  loading: css({
    padding: theme.spacing(4),
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  }),
});

export default function DryRunPreview({ preview, loading, onAddMatchCriteria }: DryRunPreviewProps) {
  const styles = useStyles2(getStyles);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Icon name="eye" size="md" />
            <Text weight="medium">Live preview</Text>
          </div>
        </div>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (preview == null) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Icon name="eye" size="md" />
            <Text weight="medium">Live preview</Text>
          </div>
          <Text variant="bodySmall" color="secondary">
            Run a dry run to see matching generations.
          </Text>
        </div>
        <div className={styles.empty}>
          <Text color="secondary">Configure your rule to see a preview of matching generations.</Text>
        </div>
      </div>
    );
  }

  const { window_hours, total_generations, matching_generations, sampled_generations, samples } = preview;

  const matchRatePct = total_generations > 0 ? ((matching_generations / total_generations) * 100).toFixed(1) : '0';
  const sampledRatePct =
    matching_generations > 0 ? ((sampled_generations / matching_generations) * 100).toFixed(1) : '0';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Icon name="eye" size="md" />
          <Text weight="medium">Live preview</Text>
        </div>
        <Text variant="bodySmall" color="secondary">
          Last {window_hours}h of traffic · {samples.length} sample{samples.length !== 1 ? 's' : ''} shown
        </Text>
        <div className={styles.statsGrid}>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{total_generations.toLocaleString()}</div>
            <div className={styles.statLabel}>Total generations</div>
          </div>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{matching_generations.toLocaleString()}</div>
            <div className={styles.statLabel}>Matching ({matchRatePct}%)</div>
          </div>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{sampled_generations.toLocaleString()}</div>
            <div className={styles.statLabel}>To evaluate ({sampledRatePct}%)</div>
          </div>
          <div className={styles.statItem}>
            <div className={styles.statValue}>
              {window_hours > 0 ? Math.round(sampled_generations / window_hours).toLocaleString() : '0'}
            </div>
            <div className={styles.statLabel}>Evaluations / hour</div>
          </div>
        </div>
      </div>
      <div className={styles.list}>
        {samples.length === 0 ? (
          <div className={styles.empty}>
            <Text color="secondary">
              {matching_generations > 0
                ? 'Matching generations exist but none were sampled. Try increasing the sample rate.'
                : 'No matching generations in the window.'}
            </Text>
          </div>
        ) : (
          samples.map((sample) => (
            <DryRunGenerationRow key={sample.generation_id} sample={sample} onAddMatchCriteria={onAddMatchCriteria} />
          ))
        )}
      </div>
    </div>
  );
}
