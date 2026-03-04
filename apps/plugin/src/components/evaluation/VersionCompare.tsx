import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Text, useStyles2 } from '@grafana/ui';
import type { EvalOutputKey } from '../../evaluation/types';

export type VersionCompareItem = {
  version: string;
  changelog?: string;
  config: Record<string, unknown>;
  outputKeys?: EvalOutputKey[];
};

export type VersionCompareProps = {
  left: VersionCompareItem;
  right: VersionCompareItem;
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
    minWidth: 0,
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

  const toDisplay = (item: VersionCompareItem) => {
    const obj: Record<string, unknown> = { config: item.config };
    if (item.outputKeys?.length) {
      obj.output_keys = item.outputKeys;
    }
    return JSON.stringify(obj, null, 2);
  };
  const leftJson = toDisplay(left);
  const rightJson = toDisplay(right);

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
