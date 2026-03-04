import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
    cursor: 'pointer',
    userSelect: 'none' as const,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    '&:hover': {
      color: theme.colors.text.primary,
      background: theme.colors.action.hover,
    },
  }),
  chevron: css({
    color: theme.colors.text.secondary,
    transition: 'transform 150ms ease',
    flexShrink: 0,
  }),
  chevronExpanded: css({
    transform: 'rotate(90deg)',
  }),
  headerLabel: css({
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    fontWeight: theme.typography.fontWeightMedium,
  }),
  headerSummary: css({
    marginLeft: 'auto',
    fontSize: 10,
    color: theme.colors.text.disabled,
    fontVariantNumeric: 'tabular-nums',
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  body: css({
    padding: `0 ${theme.spacing(1.5)} ${theme.spacing(1)}`,
    // Collapse the empty PanelChrome header bar.
    '[data-testid="header-container"]': {
      display: 'none',
    },
    // Same hack as ConversationTimelineHistogram -- forces the panel
    // to size correctly inside a flex container.
    '[data-testid="data-testid panel content"] > div > div:nth-child(2)': {
      height: '1px',
    },
  }),
  tabs: css({
    display: 'flex',
    gap: theme.spacing(0.25),
    marginBottom: theme.spacing(0.5),
  }),
  tab: css({
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    fontSize: 10,
    fontWeight: theme.typography.fontWeightMedium,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    color: theme.colors.text.disabled,
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    transition: 'color 120ms ease, background 120ms ease',
    '&:hover': {
      color: theme.colors.text.secondary,
      background: theme.colors.action.hover,
    },
  }),
  tabActive: css({
    color: theme.colors.text.primary,
    background: theme.colors.background.secondary,
  }),
});
