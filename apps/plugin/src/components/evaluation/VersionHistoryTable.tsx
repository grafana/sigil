import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, Text, useStyles2 } from '@grafana/ui';
import type { TemplateVersionSummary } from '../../evaluation/types';

export type VersionHistoryTableProps = {
  versions: TemplateVersionSummary[];
  selectedVersions: string[];
  onToggleSelect: (version: string) => void;
  onRollback?: (version: string) => void;
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

const getStyles = (theme: GrafanaTheme2) => ({
  table: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
  }),
  header: css({
    display: 'grid',
    gridTemplateColumns: 'auto 120px 1fr auto auto',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.medium}`,
    alignItems: 'center',
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: 'auto 120px 1fr auto auto',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    alignItems: 'center',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
});

export default function VersionHistoryTable({
  versions,
  selectedVersions,
  onToggleSelect,
  onRollback,
}: VersionHistoryTableProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.table}>
      <div className={styles.header}>
        <Text weight="medium" variant="bodySmall">
          Compare
        </Text>
        <Text weight="medium" variant="bodySmall">
          Version
        </Text>
        <Text weight="medium" variant="bodySmall">
          Changelog
        </Text>
        <Text weight="medium" variant="bodySmall">
          Created
        </Text>
        <div />
      </div>
      {versions.map((v) => (
        <div key={v.version} className={styles.row}>
          <Checkbox
            value={selectedVersions.includes(v.version)}
            onChange={() => onToggleSelect(v.version)}
            disabled={selectedVersions.length >= 2 && !selectedVersions.includes(v.version)}
          />
          <Text variant="bodySmall">{v.version}</Text>
          <Text truncate color="secondary" variant="bodySmall">
            {v.changelog || '—'}
          </Text>
          <Text color="secondary" variant="bodySmall">
            {formatDate(v.created_at)}
          </Text>
          {onRollback ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onRollback(v.version)}
              tooltip="Publish a new version with this config"
            >
              Rollback
            </Button>
          ) : (
            <div />
          )}
        </div>
      ))}
    </div>
  );
}
