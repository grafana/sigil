import React from 'react';
import { css } from '@emotion/css';
import { type GrafanaTheme2 } from '@grafana/data';
import { Tooltip, useStyles2 } from '@grafana/ui';
import { formatStatValue } from './dashboard/dashboardShared';

export type TopStatProps = {
  label: string;
  value: number;
  unit?: string;
  loading: boolean;
  prevValue?: number;
  prevLoading?: boolean;
  invertChange?: boolean;
  comparisonLabel?: string;
};

const DEFAULT_COMPARISON_LABEL = 'one hour ago';

export function TopStat({
  label,
  value,
  unit,
  loading,
  prevValue,
  prevLoading,
  invertChange,
  comparisonLabel = DEFAULT_COMPARISON_LABEL,
}: TopStatProps) {
  const styles = useStyles2(getStyles);

  let changeBadge: React.ReactNode = null;
  if (!loading && !prevLoading && prevValue !== undefined) {
    if (prevValue === 0 && value === 0) {
      changeBadge = (
        <Tooltip content={`Zero ${comparisonLabel}`} placement="bottom">
          <span className={`${styles.changeBadge} ${styles.changeBadgeNeutral}`}>→ 0%</span>
        </Tooltip>
      );
    } else if (prevValue === 0) {
      const isGood = !invertChange;
      const badgeClass = isGood ? styles.changeBadgeGood : styles.changeBadgeWarn;
      changeBadge = (
        <Tooltip content={`Zero ${comparisonLabel}`} placement="bottom">
          <span className={`${styles.changeBadge} ${badgeClass}`}>new</span>
        </Tooltip>
      );
    } else {
      const pctChange = ((value - prevValue) / Math.abs(prevValue)) * 100;
      const isUp = pctChange > 0;
      const isGood = invertChange ? !isUp : isUp;
      const arrow = pctChange === 0 ? '→' : isUp ? '↑' : '↓';
      const sign = isUp ? '+' : '';
      const badgeClass =
        pctChange === 0 ? styles.changeBadgeNeutral : isGood ? styles.changeBadgeGood : styles.changeBadgeWarn;
      const tooltipText = `${formatStatValue(prevValue, unit)} ${comparisonLabel}`;
      changeBadge = (
        <Tooltip content={tooltipText} placement="bottom">
          <span className={`${styles.changeBadge} ${badgeClass}`}>
            {arrow} {sign}
            {pctChange.toFixed(1)}%
          </span>
        </Tooltip>
      );
    }
  }

  return (
    <div className={styles.topStat}>
      <span className={styles.topStatLabel}>{label}</span>
      <div className={styles.topStatRow}>
        <span className={styles.topStatValue}>{loading ? '–' : formatStatValue(value, unit)}</span>
        {changeBadge}
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    topStat: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    topStatLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.2,
    }),
    topStatRow: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    topStatValue: css({
      fontSize: theme.typography.h3.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.2,
    }),
    changeBadge: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.25),
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      padding: theme.spacing(0.25, 1),
      borderRadius: 999,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
    }),
    changeBadgeGood: css({
      color: theme.colors.success.text,
      border: `1px solid ${theme.colors.success.border}`,
      background: theme.colors.success.transparent,
    }),
    changeBadgeWarn: css({
      color: theme.colors.warning.text,
      border: `1px solid ${theme.colors.warning.border}`,
      background: theme.colors.warning.transparent,
    }),
    changeBadgeNeutral: css({
      color: theme.colors.text.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      background: 'transparent',
    }),
  };
}
