import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import type { RulePreviewResponse } from '../../evaluation/types';
import DryRunGenerationRow from './DryRunGenerationRow';

export type DryRunPreviewProps = {
  preview: RulePreviewResponse | null;
  loading: boolean;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '8px',
    overflow: 'hidden',
    background: theme.colors.background.secondary,
  }),
  header: css({
    padding: theme.spacing(2),
    borderBottom: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.primary,
  }),
  counts: css({
    marginTop: theme.spacing(1),
  }),
  list: css({
    maxHeight: 320,
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

export default function DryRunPreview({ preview, loading }: DryRunPreviewProps) {
  const styles = useStyles2(getStyles);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Text weight="medium">Preview</Text>
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
          <Text weight="medium">Preview</Text>
        </div>
        <div className={styles.empty}>
          <Text color="secondary">Run a dry run to see matching generations.</Text>
        </div>
      </div>
    );
  }

  const { window_hours, total_generations, matching_generations, sampled_generations, samples } = preview;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text weight="medium">Preview: last {window_hours} hours of traffic</Text>
        <div className={styles.counts}>
          <Stack direction="row" gap={2}>
            <Text variant="bodySmall" color="secondary">
              Total: {total_generations.toLocaleString()}
            </Text>
            <Text variant="bodySmall" color="secondary">
              Matching: {matching_generations.toLocaleString()}
            </Text>
            <Text variant="bodySmall" color="secondary">
              Sampled: {sampled_generations.toLocaleString()}
            </Text>
          </Stack>
        </div>
      </div>
      <div className={styles.list}>
        {samples.length === 0 ? (
          <div className={styles.empty}>
            <Text color="secondary">No matching generations in the window.</Text>
          </div>
        ) : (
          samples.map((sample) => <DryRunGenerationRow key={sample.generation_id} sample={sample} />)
        )}
      </div>
    </div>
  );
}
