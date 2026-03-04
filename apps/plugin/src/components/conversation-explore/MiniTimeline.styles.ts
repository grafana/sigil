import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    borderTop: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
  }),
  label: css({
    fontSize: 10,
    color: theme.colors.text.disabled,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: theme.spacing(0.5),
  }),
  track: css({
    position: 'relative',
    height: 20,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    overflow: 'hidden',
  }),
  bar: css({
    position: 'absolute',
    top: 2,
    height: 16,
    borderRadius: 3,
    minWidth: 3,
    cursor: 'pointer',
    transition: 'opacity 120ms ease',
    '&:hover': {
      opacity: 0.85,
    },
  }),
  barSelected: css({
    outline: `2px solid ${theme.colors.primary.main}`,
    outlineOffset: 1,
    zIndex: 1,
  }),
  timeAxis: css({
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: theme.spacing(0.25),
  }),
  timeTick: css({
    fontSize: 9,
    color: theme.colors.text.disabled,
    fontVariantNumeric: 'tabular-nums',
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
});
