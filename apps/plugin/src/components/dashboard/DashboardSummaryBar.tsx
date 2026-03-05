import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

type DashboardSummaryBarProps = {
  children: React.ReactNode;
  className?: string;
};

export function DashboardSummaryBar({ children, className }: DashboardSummaryBarProps) {
  const styles = useStyles2(getStyles);
  return <div className={cx(styles.bar, className)}>{children}</div>;
}

function getStyles(theme: GrafanaTheme2) {
  return {
    bar: css({
      display: 'flex',
      gap: theme.spacing(4),
      padding: theme.spacing(0.5, 2, 1.5),
      flexWrap: 'wrap',
    }),
  };
}
