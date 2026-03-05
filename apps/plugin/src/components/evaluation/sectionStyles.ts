import type { GrafanaTheme2 } from '@grafana/data';

export const getSectionTitleStyles = (theme: GrafanaTheme2) => ({
  fontSize: theme.typography.size.md,
  lineHeight: theme.typography.body.lineHeight,
  fontWeight: theme.typography.fontWeightMedium,
  color: theme.colors.text.primary,
});
