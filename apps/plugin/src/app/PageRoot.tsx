import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

type PageRootProps = {
  children: React.ReactNode;
};

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    margin: theme.spacing(-3),
    minHeight: '100%',
  }),
});

export function PageRoot({ children }: PageRootProps) {
  const styles = useStyles2(getStyles);
  return <div className={styles.root}>{children}</div>;
}
