import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Checkbox, Text, useStyles2 } from '@grafana/ui';
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
    gap: theme.spacing(0.5),
  }),
  headerWithActions: css({
    display: 'grid',
    gridTemplateColumns: '72px 130px minmax(0, 1fr) 120px 96px',
    gap: theme.spacing(1.5),
    padding: theme.spacing(0.5, 0.5),
    background: 'transparent',
    alignItems: 'center',
  }),
  headerNoActions: css({
    display: 'grid',
    gridTemplateColumns: '72px 130px minmax(0, 1fr) 120px',
    gap: theme.spacing(1.5),
    padding: theme.spacing(0.5, 0.5),
    background: 'transparent',
    alignItems: 'center',
  }),
  rowWithActions: css({
    display: 'grid',
    gridTemplateColumns: '72px 130px minmax(0, 1fr) 120px 96px',
    gap: theme.spacing(1.5),
    padding: theme.spacing(0.75, 0.5),
    alignItems: 'center',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    transition: 'background-color 120ms ease, border-color 120ms ease',
    '&:hover': {
      background: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
    },
  }),
  rowNoActions: css({
    display: 'grid',
    gridTemplateColumns: '72px 130px minmax(0, 1fr) 120px',
    gap: theme.spacing(1.5),
    padding: theme.spacing(0.75, 0.5),
    alignItems: 'center',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    transition: 'background-color 120ms ease, border-color 120ms ease',
    '&:hover': {
      background: theme.colors.action.hover,
      borderColor: theme.colors.border.medium,
    },
  }),
  rowSelected: css({
    background: theme.colors.action.hover,
    borderColor: theme.colors.primary.border,
  }),
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
  const hasActions = onRollback != null;
  const headerClassName = hasActions ? styles.headerWithActions : styles.headerNoActions;
  const rowClassName = hasActions ? styles.rowWithActions : styles.rowNoActions;

  return (
    <div className={styles.table}>
      <div className={headerClassName}>
        <div className={styles.headerText}>
          <Text weight="medium" variant="bodySmall">
            Compare
          </Text>
        </div>
        <div className={styles.headerText}>
          <Text weight="medium" variant="bodySmall">
            Version
          </Text>
        </div>
        <div className={styles.headerText}>
          <Text weight="medium" variant="bodySmall">
            Changelog
          </Text>
        </div>
        <div className={styles.headerText}>
          <Text weight="medium" variant="bodySmall">
            Created
          </Text>
        </div>
        {hasActions && <div />}
      </div>
      {versions.length === 0 && (
        <div className={styles.empty}>
          <Text color="secondary" variant="bodySmall">
            No versions yet.
          </Text>
        </div>
      )}
      {versions.map((v) => {
        const isSelected = selectedVersions.includes(v.version);
        return (
          <div key={v.version} className={isSelected ? `${rowClassName} ${styles.rowSelected}` : rowClassName}>
            <div className={styles.compareCell}>
              <Checkbox
                value={isSelected}
                onChange={() => onToggleSelect(v.version)}
                disabled={selectedVersions.length >= 2 && !isSelected}
              />
            </div>
            <div className={styles.versionCell}>
              <Badge text={v.version} color={isSelected ? 'blue' : 'purple'} />
            </div>
            <div className={styles.changelogCell}>
              <Text truncate color="secondary" variant="bodySmall">
                {v.changelog || 'No changelog provided'}
              </Text>
            </div>
            <Text color="secondary" variant="bodySmall">
              {formatDate(v.created_at)}
            </Text>
            {hasActions && (
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
            )}
          </div>
        );
      })}
    </div>
  );
}
