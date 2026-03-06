import { css, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

const blink = keyframes({
  '0%, 50%': { opacity: 1 },
  '50.01%, 100%': { opacity: 0 },
});

export const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    padding: `${theme.spacing(1.5)} 20px`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  }),
  conversationId: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  conversationTitle: css({
    fontFamily: theme.typography.fontFamily,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  typewriterCursor: css({
    display: 'inline-block',
    marginLeft: theme.spacing(0.25),
    color: theme.colors.text.secondary,
    [theme.transitions.handleMotion('no-preference', 'reduce')]: {
      animation: `${blink} 1s steps(1, end) infinite`,
    },
  }),
  separator: css({
    width: 1,
    height: 20,
    background: theme.colors.border.weak,
    flexShrink: 0,
  }),
  metric: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
  }),
  metricValue: css({
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    fontVariantNumeric: 'tabular-nums',
  }),
  modelChips: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginLeft: 'auto',
    flexWrap: 'wrap' as const,
  }),
  modelChipAnchor: css({
    position: 'relative' as const,
    display: 'inline-flex',
  }),
  modelChip: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: '12px',
    fontSize: theme.typography.bodySmall.fontSize,
    background: `var(--chip-bg, ${theme.colors.background.secondary})`,
    color: theme.colors.text.primary,
    border: `1px solid var(--chip-border-color, ${theme.colors.border.medium})`,
    transition: 'border-color 0.15s, background 0.15s',
    '&:hover:not(:disabled)': {
      borderColor: theme.colors.text.secondary,
      background: theme.colors.action.hover,
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.9,
    },
  }),
  modelChipButton: css({
    appearance: 'none',
    font: 'inherit',
    cursor: 'pointer',
  }),
  modelChipActive: css({
    borderColor: theme.colors.primary.border,
    background: theme.colors.primary.transparent,
  }),
  providerDot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  }),
  statusBadge: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.pill,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  statusSuccess: css({
    background: theme.colors.success.transparent,
    color: theme.colors.success.text,
  }),
  statusError: css({
    background: theme.colors.error.transparent,
    color: theme.colors.error.text,
  }),
  saveButton: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(0.5),
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: theme.colors.text.disabled,
    borderRadius: theme.shape.radius.default,
    transition: 'color 120ms ease',
    '&:hover': {
      color: theme.colors.warning.main,
    },
  }),
  saveButtonActive: css({
    color: theme.colors.warning.main,
  }),
});
