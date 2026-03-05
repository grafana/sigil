import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export const getTokenizeControlStyles = (theme: GrafanaTheme2) => ({
  tokenizeBtn: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.375),
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    fontSize: 10,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    background: 'transparent',
    border: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    transition: 'all 120ms ease',
    '&:hover': {
      color: theme.colors.text.primary,
      borderColor: theme.colors.border.medium,
      background: theme.colors.action.hover,
    },
  }),
  tokenizeBtnActive: css({
    color: theme.colors.primary.text,
    borderColor: theme.colors.primary.border,
    background: theme.colors.primary.transparent,
  }),
  encodingSelect: css({
    marginLeft: theme.spacing(0.5),
    fontSize: 10,
    padding: `1px ${theme.spacing(0.5)}`,
    height: 22,
    width: 'fit-content',
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    appearance: 'auto' as const,
    '&:focus': {
      borderColor: theme.colors.primary.border,
      outline: 'none',
    },
  }),
});
