import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
  }),
  headerTitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  }),
  treeContainer: css({
    flex: 1,
    overflowY: 'auto' as const,
    padding: `${theme.spacing(0.5)} 0`,
  }),
  emptyState: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(4),
    color: theme.colors.text.disabled,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});
