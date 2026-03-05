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
    transition: 'outline 100ms ease',
    '&:hover': {
      outline: `1px solid ${theme.colors.border.medium}`,
      outlineOffset: -1,
    },
  }),
  truncated: css({
    color: theme.colors.text.disabled,
    fontStyle: 'italic',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  transparencyPct: getTransparencyPct(theme),
});
