import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export const getStyles = (theme: GrafanaTheme2) => ({
  row: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
    cursor: 'pointer',
    borderRadius: theme.shape.radius.default,
    transition: 'background 120ms ease',
    userSelect: 'none' as const,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowSelected: css({
    background: theme.colors.action.selected,
    '&:hover': {
      background: theme.colors.action.selected,
    },
  }),
  agentRow: css({
    cursor: 'pointer',
    fontWeight: theme.typography.fontWeightMedium,
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  chevron: css({
    flexShrink: 0,
    color: theme.colors.text.secondary,
    transition: 'transform 150ms ease',
  }),
  chevronExpanded: css({
    transform: 'rotate(90deg)',
  }),
  badge: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.03em',
    textTransform: 'uppercase' as const,
    lineHeight: 1,
    flexShrink: 0,
    minWidth: 32,
  }),
  modelDot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  badgeTool: css({
    background: 'oklch(0.55 0.12 180 / 0.15)',
    color: 'oklch(0.50 0.12 180)',
    ...(theme.isDark && {
      background: 'oklch(0.65 0.12 180 / 0.2)',
      color: 'oklch(0.75 0.10 180)',
    }),
  }),
  badgeEmbedding: css({
    background: 'oklch(0.55 0.15 300 / 0.15)',
    color: 'oklch(0.50 0.15 300)',
    ...(theme.isDark && {
      background: 'oklch(0.65 0.15 300 / 0.2)',
      color: 'oklch(0.75 0.12 300)',
    }),
  }),
  badgeToolCall: css({
    background: 'oklch(0.55 0.10 220 / 0.15)',
    color: 'oklch(0.50 0.10 220)',
    ...(theme.isDark && {
      background: 'oklch(0.65 0.10 220 / 0.2)',
      color: 'oklch(0.75 0.08 220)',
    }),
  }),
  generationIndex: css({
    fontSize: 10,
    fontWeight: 600,
    color: theme.colors.text.secondary,
    fontVariantNumeric: 'tabular-nums',
    fontFamily: theme.typography.fontFamilyMonospace,
    flexShrink: 0,
    minWidth: 18,
    textAlign: 'right' as const,
  }),
  label: css({
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
  }),
  agentLabel: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  duration: css({
    flexShrink: 0,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontVariantNumeric: 'tabular-nums',
    fontFamily: theme.typography.fontFamilyMonospace,
    width: 52,
    textAlign: 'right' as const,
  }),
  statusDot: css({
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  statusSuccess: css({
    background: theme.colors.success.main,
  }),
  statusError: css({
    background: theme.colors.error.main,
  }),
  tokenCount: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.disabled,
    fontVariantNumeric: 'tabular-nums',
    fontFamily: theme.typography.fontFamilyMonospace,
    flexShrink: 0,
    width: 32,
    textAlign: 'right' as const,
  }),
  costLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontVariantNumeric: 'tabular-nums',
    fontFamily: theme.typography.fontFamilyMonospace,
    flexShrink: 0,
    width: 52,
    textAlign: 'right' as const,
  }),
  valueHighlight: css({
    color: theme.isDark ? 'oklch(0.75 0.15 25)' : 'oklch(0.50 0.18 25)',
    fontWeight: 600,
  }),
  searchHighlight: css({
    background: theme.isDark ? 'oklch(0.70 0.18 85 / 0.35)' : 'oklch(0.85 0.18 85 / 0.5)',
    color: 'inherit',
    borderRadius: 2,
    padding: '0 1px',
  }),
  contentMatchBadge: css({
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    color: theme.isDark ? 'oklch(0.75 0.12 85)' : 'oklch(0.55 0.12 85)',
    opacity: 0.8,
  }),
  childrenContainer: css({
    paddingLeft: theme.spacing(2),
  }),
});
