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
  rightAlignContent?: boolean;
  size?: 'default' | 'large';
  sparklineData?: number[];
};

const DEFAULT_COMPARISON_LABEL = 'previous 24 hours';

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
  rightAlignContent = false,
  size = 'default',
  sparklineData,
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

  const helpIcon = helpTooltip ? (
    <Tooltip content={helpTooltip} placement="top">
      <span className={styles.topStatHelpIcon} aria-label={`${label} help`}>
        <Icon name="info-circle" size="sm" />
      </span>
    </Tooltip>
  ) : null;

  const content = (
    <>
      <div className={cx(styles.topStatLabelRow, rightAlignContent && styles.topStatLabelRowRightAligned)}>
        <span className={cx(styles.topStatLabelGroup, rightAlignContent && styles.topStatLabelGroupRightAligned)}>
          {helpIcon && rightAlignContent && helpIcon}
          <span className={cx(styles.topStatLabel, compact && styles.topStatLabelCompact)}>{label}</span>
          {helpIcon && !rightAlignContent && helpIcon}
        </span>
        {to && linkLabel && (
          <Link to={to} className={styles.topStatDetailLink}>
            {linkLabel}
          </Link>
        )}
      </div>
      <div
        className={cx(
          styles.topStatRow,
          compact && styles.topStatRowCompact,
          rightAlignContent && styles.topStatRowRightAligned
        )}
      >
        <span
          className={cx(
            size === 'large' ? styles.topStatValueLarge : styles.topStatValue,
            compact && styles.topStatValueCompact,
            normalFontSize && styles.topStatValueNormalFont,
            rightAlignContent && styles.topStatValueRightAligned
          )}
        >
          {loading ? '–' : (displayValue ?? formatStatValue(value, unit))}
        </span>
        {changeBadge}
      </div>
      {sparklineData !== undefined && (
        <div className={styles.sparklineSlot}>
          {sparklineData.length > 1 ? (
            <MiniSparkline data={sparklineData} />
          ) : (
            <div className={styles.sparklineSkeleton} />
          )}
        </div>
      )}
    </>
  );

  if (to && !linkLabel) {
    return (
      <Link
        to={to}
        className={cx(
          styles.topStat,
          styles.topStatClickable,
          compact && styles.topStatCompact,
          rightAlignContent && styles.topStatRightAligned
        )}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      className={cx(styles.topStat, compact && styles.topStatCompact, rightAlignContent && styles.topStatRightAligned)}
    >
      {content}
    </div>
  );
}

const SPARKLINE_W = 120;
const SPARKLINE_H = 24;

function MiniSparkline({ data }: { data: number[] }) {
  const styles = useStyles2(getStyles);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * SPARKLINE_W;
      const y = SPARKLINE_H - ((v - min) / range) * (SPARKLINE_H - 2) - 1;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline points={points} />
    </svg>
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
    topStatRightAligned: css({
      alignItems: 'flex-end',
      textAlign: 'right',
    }),
    topStatLabelRow: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      minHeight: theme.spacing(3),
    }),
    topStatLabelRowRightAligned: css({
      justifyContent: 'flex-end',
    }),
    topStatLabelGroup: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      minWidth: 0,
    }),
    topStatLabelGroupRightAligned: css({
      justifyContent: 'flex-end',
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
    topStatClickable: css({
      textDecoration: 'none',
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(1.5, 2),
      margin: theme.spacing(-1.5, -2),
      transition: 'background 0.15s ease',
      '&:hover': {
        background: theme.colors.action.hover,
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
    topStatRowRightAligned: css({
      justifyContent: 'flex-end',
    }),
    topStatRowCompact: css({
      gap: theme.spacing(0.5),
    }),
    topStatValue: css({
      fontSize: theme.typography.h3.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      lineHeight: 1.2,
      fontVariantNumeric: 'tabular-nums',
    }),
    topStatValueLarge: css({
      fontSize: theme.typography.h2.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      lineHeight: 1.1,
      fontVariantNumeric: 'tabular-nums',
    }),
    topStatValueCompact: css({
      fontSize: theme.typography.h5.fontSize,
      lineHeight: 1.15,
    }),
    topStatValueNormalFont: css({
      fontSize: theme.typography.body.fontSize,
      lineHeight: 1.3,
    }),
    topStatValueRightAligned: css({
      textAlign: 'right',
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
    sparklineSlot: css({
      height: SPARKLINE_H,
      marginTop: theme.spacing(0.5),
    }),
    sparklineSkeleton: css({
      width: SPARKLINE_W,
      height: SPARKLINE_H,
      borderRadius: theme.shape.radius.default,
      background: `linear-gradient(90deg, ${theme.colors.action.hover} 25%, ${theme.colors.border.weak} 50%, ${theme.colors.action.hover} 75%)`,
      backgroundSize: '200% 100%',
      animation: 'sparkline-shimmer 1.8s ease-in-out infinite',
      '@keyframes sparkline-shimmer': {
        '0%': { backgroundPosition: '200% 0' },
        '100%': { backgroundPosition: '-200% 0' },
      },
    }),
    sparkline: css({
      width: SPARKLINE_W,
      height: SPARKLINE_H,
      display: 'block',
      '& polyline': {
        fill: 'none',
        stroke: theme.colors.primary.main,
        strokeWidth: 1.5,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      },
    }),
  };
}
