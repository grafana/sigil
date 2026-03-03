import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Stack, Text, useStyles2 } from '@grafana/ui';
import type { PreviewGenerationSample } from '../../evaluation/types';

export type DryRunGenerationRowProps = {
  sample: PreviewGenerationSample;
};

const TRUNCATE_LEN = 24;
const PREVIEW_LEN = 80;

function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) {
    return s;
  }
  return `${chars.slice(0, max).join('')}…`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({
    padding: theme.spacing(1, 2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  }),
  meta: css({
    color: theme.colors.text.secondary,
  }),
  preview: css({
    marginTop: theme.spacing(0.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    color: theme.colors.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  }),
});

export default function DryRunGenerationRow({ sample }: DryRunGenerationRowProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.row}>
      <Stack direction="row" gap={2} alignItems="center" wrap="wrap">
        <Text weight="medium" variant="bodySmall">
          {truncate(sample.generation_id, TRUNCATE_LEN)}
        </Text>
        {sample.agent_name != null && (
          <Text variant="bodySmall" color="secondary">
            {sample.agent_name}
          </Text>
        )}
        {sample.model != null && (
          <Text variant="bodySmall" color="secondary">
            {sample.model}
          </Text>
        )}
        <span className={styles.meta}>
          <Text variant="bodySmall" color="secondary">
            {formatDate(sample.created_at)}
          </Text>
        </span>
      </Stack>
      {sample.input_preview != null && sample.input_preview.length > 0 && (
        <div className={styles.preview} title={sample.input_preview}>
          {truncate(sample.input_preview, PREVIEW_LEN)}
        </div>
      )}
    </div>
  );
}
