import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Text, useStyles2 } from '@grafana/ui';
import type { TemplateVersion } from '../../evaluation/types';

export type VersionCompareProps = {
  left: TemplateVersion;
  right: TemplateVersion;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: theme.spacing(2),
  }),
  panel: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  header: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
    padding: theme.spacing(1),
    background: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
  }),
  code: css({
    padding: theme.spacing(1),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'auto',
    whiteSpace: 'pre' as const,
    maxHeight: 400,
  }),
});

export default function VersionCompare({ left, right }: VersionCompareProps) {
  const styles = useStyles2(getStyles);

  const leftJson = JSON.stringify(left.config, null, 2);
  const rightJson = JSON.stringify(right.config, null, 2);

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <Text weight="medium">Version {left.version}</Text>
          {left.changelog && (
            <Text color="secondary" variant="bodySmall">
              {left.changelog}
            </Text>
          )}
        </div>
        <div className={styles.code}>{leftJson}</div>
      </div>
      <div className={styles.panel}>
        <div className={styles.header}>
          <Text weight="medium">Version {right.version}</Text>
          {right.changelog && (
            <Text color="secondary" variant="bodySmall">
              {right.changelog}
            </Text>
          )}
        </div>
        <div className={styles.code}>{rightJson}</div>
      </div>
    </div>
  );
}
