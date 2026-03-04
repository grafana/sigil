import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2, type IconName } from '@grafana/ui';

export type PipelineNodeKind = 'selector' | 'match' | 'sample' | 'evaluator';

export type PipelineNodeProps = {
  kind: PipelineNodeKind;
  label: string;
  detail?: string;
  /** Subway-map style: circle on track with label below */
  trackStop?: boolean;
  /** Fixed-width grid cell: icon + truncated label for uniform pipeline columns */
  cell?: boolean;
  onClick?: () => void;
};

const KIND_ICONS: Record<PipelineNodeKind, IconName> = {
  selector: 'filter',
  match: 'search',
  sample: 'percentage',
  evaluator: 'check-circle',
};

const getStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;
  return {
    node: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      padding: theme.spacing(0.5, 1.25),
      borderRadius: theme.shape.radius.pill,
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.primary,
      lineHeight: 1.4,
      border: 'none',
      background: 'transparent',
      maxWidth: '100%',
    }),
    label: css({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
    }),
    nodeClickable: css({
      cursor: 'pointer',
      '&:hover': {
        background: theme.colors.action.hover,
      },
    }),
    iconWrap: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 22,
      height: 22,
      borderRadius: theme.shape.radius.sm,
      flexShrink: 0,
    }),
    kindSelector: css({
      background: isDark ? 'rgba(115, 191, 105, 0.15)' : 'rgba(115, 191, 105, 0.12)',
      color: 'rgb(115, 191, 105)',
    }),
    kindMatch: css({
      background: isDark ? 'rgba(61, 113, 217, 0.15)' : 'rgba(61, 113, 217, 0.12)',
      color: 'rgb(61, 113, 217)',
    }),
    kindSample: css({
      background: isDark ? 'rgba(255, 152, 48, 0.15)' : 'rgba(255, 152, 48, 0.12)',
      color: 'rgb(255, 152, 48)',
    }),
    kindEvaluator: css({
      background: isDark ? 'rgba(138, 109, 245, 0.15)' : 'rgba(138, 109, 245, 0.12)',
      color: 'rgb(138, 109, 245)',
    }),
    detail: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    trackStop: css({
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
    trackCircle: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      borderRadius: '50%',
      border: `2px solid ${theme.colors.background.primary}`,
      boxShadow: theme.shadows.z1,
      flexShrink: 0,
    }),
    trackLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      textAlign: 'center' as const,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
      maxWidth: '100%',
    }),
    cell: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      padding: theme.spacing(0.75, 1),
      minWidth: 0,
      width: '100%',
    }),
    cellButton: css({
      background: 'none',
      border: 'none',
      font: 'inherit',
      color: 'inherit',
      cursor: 'pointer',
      textAlign: 'left' as const,
      justifyContent: 'flex-start',
    }),
    cellLabel: css({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
  };
};

const KIND_STYLE_MAP: Record<PipelineNodeKind, keyof ReturnType<typeof getStyles>> = {
  selector: 'kindSelector',
  match: 'kindMatch',
  sample: 'kindSample',
  evaluator: 'kindEvaluator',
};

export default function PipelineNode({ kind, label, detail, trackStop, cell, onClick }: PipelineNodeProps) {
  const styles = useStyles2(getStyles);
  const iconName = KIND_ICONS[kind];
  const isClickable = onClick != null;
  const kindStyle = styles[KIND_STYLE_MAP[kind]];

  if (cell) {
    const cellContent = (
      <>
        <span className={cx(styles.iconWrap, kindStyle)}>
          <Icon name={iconName} size="sm" />
        </span>
        <span className={styles.cellLabel} title={label}>
          {label}
        </span>
      </>
    );
    return isClickable ? (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cx(styles.cell, styles.cellButton, styles.nodeClickable)}
      >
        {cellContent}
      </button>
    ) : (
      <div className={styles.cell}>{cellContent}</div>
    );
  }

  if (trackStop) {
    const circle = (
      <span className={cx(styles.trackCircle, kindStyle)}>
        <Icon name={iconName} size="sm" />
      </span>
    );
    return (
      <div className={styles.trackStop}>
        {isClickable ? (
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            {circle}
          </button>
        ) : (
          circle
        )}
        <span className={styles.trackLabel} title={label}>
          {label}
        </span>
        {detail != null && detail.length > 0 && (
          <span className={styles.detail} style={{ fontSize: '0.7em' }}>
            {detail}
          </span>
        )}
      </div>
    );
  }

  const content = (
    <>
      <span className={cx(styles.iconWrap, kindStyle)}>
        <Icon name={iconName} size="sm" />
      </span>
      <span className={styles.label} title={label}>
        {label}
      </span>
      {detail != null && detail.length > 0 && <span className={styles.detail}>{detail}</span>}
    </>
  );

  if (isClickable) {
    return (
      <button type="button" className={cx(styles.node, styles.nodeClickable)} onClick={onClick} aria-label={label}>
        {content}
      </button>
    );
  }

  return <span className={styles.node}>{content}</span>;
}
