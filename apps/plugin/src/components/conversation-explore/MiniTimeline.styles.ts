import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    flexShrink: 0,
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(0.5),
  }),
  label: css({
    fontSize: 10,
    color: theme.colors.text.disabled,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  }),
  collapseButton: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(0.25),
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: theme.colors.text.disabled,
    borderRadius: theme.shape.radius.default,
    transition: 'color 120ms ease',
    '&:hover': {
      color: theme.colors.text.primary,
    },
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
