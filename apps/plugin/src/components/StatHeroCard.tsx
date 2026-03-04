import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';

export type StatHeroCardProps = {
  title: string;
  value: string | number;
  info: string;
};

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.canvas,
    padding: `${theme.spacing(1.25)} ${theme.spacing(1.5)}`,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.25),
  }),
  titleRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  }),
  title: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    lineHeight: 1.4,
  }),
  infoPill: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: `1px solid ${theme.colors.border.medium}`,
    color: theme.colors.text.disabled,
    cursor: 'default',
    flexShrink: 0,
    transition: 'border-color 120ms ease, color 120ms ease',
    '&:hover': {
      borderColor: theme.colors.text.secondary,
      color: theme.colors.text.secondary,
    },
  }),
  value: css({
    fontSize: theme.typography.h3.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    color: theme.colors.text.primary,
    lineHeight: 1.2,
    letterSpacing: '-0.01em',
  }),
});

export function StatHeroCard({ title, value, info }: StatHeroCardProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.card}>
      <div className={styles.titleRow}>
        <span className={styles.title}>{title}</span>
        <Tooltip content={info} placement="top">
          <span className={styles.infoPill}>
            <Icon name="info-circle" size="xs" />
          </span>
        </Tooltip>
      </div>
      <span className={styles.value}>{typeof value === 'number' ? value.toLocaleString() : value}</span>
    </div>
  );
}
