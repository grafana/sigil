import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export function getTransparencyPct(theme: GrafanaTheme2): number {
  return theme.isDark ? 75 : 65;
}

export const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.6,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  token: css({
    borderRadius: 2,
    padding: '1px 0',
    cursor: 'default',
    outline: '1px solid transparent',
    outlineOffset: -1,
    transition: 'outline-color 100ms ease',
    '&:hover': {
      outlineColor: theme.colors.border.medium,
    },
  }),
  truncated: css({
    color: theme.colors.text.disabled,
    fontStyle: 'italic',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  tip: css({
    position: 'fixed',
    transform: 'translate(-50%, -100%) translateY(-4px)',
    padding: `2px ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    fontSize: 10,
    fontFamily: theme.typography.fontFamilyMonospace,
    color: theme.colors.text.secondary,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    zIndex: theme.zIndex.tooltip,
    boxShadow: theme.shadows.z2,
  }),
  transparencyPct: getTransparencyPct(theme),
});
