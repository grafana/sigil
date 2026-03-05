import React from 'react';
import { css, cx } from '@emotion/css';
import { type GrafanaTheme2 } from '@grafana/data';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import { Link } from 'react-router-dom';
import { formatStatValue } from './dashboard/dashboardShared';

export type TopStatProps = {
  label: string;
  value: number;
  displayValue?: string;
  unit?: string;
  loading: boolean;
  compact?: boolean;
  normalFontSize?: boolean;
  prevValue?: number;
  prevLoading?: boolean;
  invertChange?: boolean;
  comparisonLabel?: string;
  to?: string;
  linkLabel?: string;
  helpTooltip?: string | React.ReactElement;
};

const DEFAULT_COMPARISON_LABEL = 'one hour ago';

export function TopStat({
  label,
  value,
  displayValue,
  unit,
  loading,
  compact = false,
  normalFontSize = false,
  prevValue,
  prevLoading,
  invertChange,
  comparisonLabel = DEFAULT_COMPARISON_LABEL,
  to,
  linkLabel,
  helpTooltip,
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
          <span className={`${styles.changeBadge} ${badgeClass}`}>↑ 0</span>
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
    <div className={cx(styles.topStat, compact && styles.topStatCompact)}>
      <div className={styles.topStatLabelRow}>
        <span className={styles.topStatLabelGroup}>
          <span className={cx(styles.topStatLabel, compact && styles.topStatLabelCompact)}>{label}</span>
          {helpTooltip && (
            <Tooltip content={helpTooltip} placement="top">
              <span className={styles.topStatHelpIcon} aria-label={`${label} help`}>
                <Icon name="info-circle" size="sm" />
              </span>
            </Tooltip>
          )}
        </span>
        {to && (
          <Link to={to} className={styles.topStatDetailLink}>
            {linkLabel ?? 'View details'}
          </Link>
        )}
      </div>
      <div className={cx(styles.topStatRow, compact && styles.topStatRowCompact)}>
        <span
          className={cx(
            styles.topStatValue,
            compact && styles.topStatValueCompact,
            normalFontSize && styles.topStatValueNormalFont
          )}
        >
          {loading ? '–' : (displayValue ?? formatStatValue(value, unit))}
        </span>
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
    topStatCompact: css({
      gap: theme.spacing(0.75),
    }),
    topStatLabelRow: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      minHeight: theme.spacing(3),
    }),
    topStatLabelGroup: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      minWidth: 0,
    }),
    topStatHelpIcon: css({
      display: 'inline-flex',
      alignItems: 'center',
      color: theme.colors.text.secondary,
      lineHeight: 1,
    }),
    topStatDetailLink: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      textDecoration: 'none',
      whiteSpace: 'nowrap',
      padding: theme.spacing(0.25, 1),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: 'transparent',
      transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
      '&:hover': {
        background: theme.colors.action.hover,
        color: theme.colors.text.primary,
        borderColor: theme.colors.border.medium,
      },
    }),
    topStatLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.2,
    }),
    topStatLabelCompact: css({
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.1,
      letterSpacing: '0.02em',
    }),
    topStatRow: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    topStatRowCompact: css({
      gap: theme.spacing(0.5),
    }),
    topStatValue: css({
      fontSize: theme.typography.h3.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.2,
    }),
    topStatValueCompact: css({
      fontSize: theme.typography.h5.fontSize,
      lineHeight: 1.15,
    }),
    topStatValueNormalFont: css({
      fontSize: theme.typography.body.fontSize,
      lineHeight: 1.3,
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
