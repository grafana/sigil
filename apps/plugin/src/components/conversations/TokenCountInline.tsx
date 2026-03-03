import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

export type TokenCountInlineProps = {
  inputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
};

function formatTokenValue(value: unknown): string {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return 'n/a';
  }

  return parsed.toLocaleString();
}

const getStyles = (theme: GrafanaTheme2) => ({
  inline: css({
    label: 'tokenCountInline-inline',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    lineHeight: 1.3,
    whiteSpace: 'nowrap' as const,
  }),
  group: css({
    label: 'tokenCountInline-group',
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: theme.spacing(0.375),
  }),
  divider: css({
    label: 'tokenCountInline-divider',
    width: '1px',
    height: '14px',
    background: theme.colors.border.weak,
  }),
  groupLabel: css({
    label: 'tokenCountInline-groupLabel',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  groupValue: css({
    label: 'tokenCountInline-groupValue',
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    fontVariantNumeric: 'tabular-nums',
  }),
});

export default function TokenCountInline({ inputTokens, outputTokens, totalTokens }: TokenCountInlineProps) {
  const styles = useStyles2(getStyles);
  const tokenItems = [
    { label: 'IN', value: formatTokenValue(inputTokens) },
    { label: 'OUT', value: formatTokenValue(outputTokens) },
    { label: '=', value: formatTokenValue(totalTokens) },
  ];

  return (
    <span className={styles.inline} aria-label="Token usage">
      {tokenItems.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 && <span className={styles.divider} aria-hidden="true" />}
          <span className={styles.group}>
            <span className={styles.groupLabel}>{item.label}</span>
            <span className={styles.groupValue}>{item.value}</span>
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}
