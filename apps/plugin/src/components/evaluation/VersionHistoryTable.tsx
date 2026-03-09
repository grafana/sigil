import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Checkbox, Text, useStyles2 } from '@grafana/ui';
import DataTable, { type ColumnDef } from '../shared/DataTable';
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
  compareCell: css({
    display: 'flex',
    justifyContent: 'center',
  }),
  versionCell: css({
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
  }),
  changelogCell: css({
    minWidth: 0,
  }),
  actionsCell: css({
    display: 'flex',
    justifyContent: 'flex-end',
  }),
  headerText: css({
    whiteSpace: 'nowrap' as const,
    minWidth: 0,
  }),
  empty: css({
    padding: theme.spacing(2, 0.5),
    border: `1px dashed ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
  }),
});

export default function VersionHistoryTable({
  versions,
  selectedVersions,
  onToggleSelect,
  onRollback,
}: VersionHistoryTableProps) {
  const styles = useStyles2(getStyles);

  const columns = useMemo((): Array<ColumnDef<TemplateVersionSummary>> => {
    const base: Array<ColumnDef<TemplateVersionSummary>> = [
      {
        id: 'compare',
        header: (
          <span className={styles.headerText}>
            <Text weight="medium" variant="bodySmall">
              Compare
            </Text>
          </span>
        ),
        width: 72,
        cell: (v: TemplateVersionSummary) => {
          const isSelected = selectedVersions.includes(v.version);
          return (
            <div className={styles.compareCell}>
              <Checkbox
                value={isSelected}
                onChange={() => onToggleSelect(v.version)}
                disabled={selectedVersions.length >= 2 && !isSelected}
              />
            </div>
          );
        },
      },
      {
        id: 'version',
        header: (
          <span className={styles.headerText}>
            <Text weight="medium" variant="bodySmall">
              Version
            </Text>
          </span>
        ),
        cell: (v: TemplateVersionSummary) => (
          <div className={styles.versionCell}>
            <Badge text={v.version} color={selectedVersions.includes(v.version) ? 'blue' : 'purple'} />
          </div>
        ),
      },
      {
        id: 'changelog',
        header: (
          <span className={styles.headerText}>
            <Text weight="medium" variant="bodySmall">
              Changelog
            </Text>
          </span>
        ),
        cell: (v: TemplateVersionSummary) => (
          <div className={styles.changelogCell}>
            <Text truncate color="secondary" variant="bodySmall">
              {v.changelog || 'No changelog provided'}
            </Text>
          </div>
        ),
      },
      {
        id: 'created',
        header: (
          <span className={styles.headerText}>
            <Text weight="medium" variant="bodySmall">
              Created
            </Text>
          </span>
        ),
        cell: (v: TemplateVersionSummary) => (
          <Text color="secondary" variant="bodySmall">
            {formatDate(v.created_at)}
          </Text>
        ),
      },
    ];
    if (onRollback != null) {
      base.push({
        id: 'actions',
        header: '',
        cell: (v: TemplateVersionSummary) => (
          <div className={styles.actionsCell}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onRollback(v.version)}
              tooltip="Publish a new version with this config"
            >
              Rollback
            </Button>
          </div>
        ),
      });
    }
    return base;
  }, [onRollback, onToggleSelect, selectedVersions, styles]);

  return (
    <DataTable<TemplateVersionSummary>
      columns={columns}
      data={versions}
      keyOf={(v) => v.version}
      isSelected={(v) => selectedVersions.includes(v.version)}
      emptyMessage="No versions yet."
      panelTitle="Version history"
    />
  );
}
