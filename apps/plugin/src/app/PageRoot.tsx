import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

type PageRootProps = {
  children: React.ReactNode;
  fullBleed?: boolean;
};

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    margin: theme.spacing(-3),
    minHeight: '100%',
  }),
  rootFullBleed: css({
    margin: 0,
  }),
});

export function PageRoot({ children, fullBleed = false }: PageRootProps) {
  const styles = useStyles2(getStyles);
  return <div className={cx(styles.root, fullBleed && styles.rootFullBleed)}>{children}</div>;
}
