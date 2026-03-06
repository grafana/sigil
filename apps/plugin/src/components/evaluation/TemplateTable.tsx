import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, ConfirmModal, IconButton, Text, useStyles2 } from '@grafana/ui';
import { EVALUATOR_KIND_LABELS, getKindBadgeColor, type TemplateDefinition } from '../../evaluation/types';

export type TemplateTableProps = {
  templates: TemplateDefinition[];
  onSelect?: (templateID: string) => void;
  onDelete?: (templateID: string) => void;
  onFork?: (templateID: string) => void;
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
    gridTemplateColumns: '2fr 100px 80px 100px 3fr 100px 80px',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.medium}`,
    alignItems: 'center',
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: '2fr 100px 80px 100px 3fr 100px 80px',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    alignItems: 'center',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowGlobal: css({
    borderLeft: '2px solid rgba(255, 166, 0, 0.35)',
    '&:hover': {
      borderLeftColor: 'rgba(255, 166, 0, 0.55)',
    },
  }),
  rowTenant: css({
    borderLeft: '2px solid rgba(61, 113, 217, 0.28)',
    '&:hover': {
      borderLeftColor: 'rgba(61, 113, 217, 0.46)',
    },
  }),
  templateId: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 0,
  }),
  actions: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(0.5),
  }),
});

export default function TemplateTable({ templates, onSelect, onDelete, onFork }: TemplateTableProps) {
  const styles = useStyles2(getStyles);
  const [pendingDeleteID, setPendingDeleteID] = useState<string | null>(null);

  return (
    <>
      <ConfirmModal
        isOpen={pendingDeleteID !== null}
        title="Delete template"
        body={`Are you sure you want to delete template "${pendingDeleteID}"? This cannot be undone.`}
        confirmText="Delete"
        icon="trash-alt"
        onConfirm={() => {
          if (pendingDeleteID) {
            onDelete?.(pendingDeleteID);
          }
          setPendingDeleteID(null);
        }}
        onDismiss={() => setPendingDeleteID(null)}
      />
      <div className={styles.table}>
        <div className={styles.header}>
          <Text weight="medium" variant="bodySmall">
            Template
          </Text>
          <Text weight="medium" variant="bodySmall">
            Kind
          </Text>
          <Text weight="medium" variant="bodySmall">
            Scope
          </Text>
          <Text weight="medium" variant="bodySmall">
            Version
          </Text>
          <Text weight="medium" variant="bodySmall">
            Description
          </Text>
          <Text weight="medium" variant="bodySmall">
            Created
          </Text>
          <div />
        </div>
        {templates.map((template) => (
          <div
            key={template.template_id}
            className={`${styles.row} ${template.scope === 'global' ? styles.rowGlobal : styles.rowTenant}`}
            onClick={() => onSelect?.(template.template_id)}
            role="row"
          >
            <div className={styles.templateId}>
              <Text weight="medium" truncate>
                {template.template_id}
              </Text>
            </div>
            <div>
              <Badge text={EVALUATOR_KIND_LABELS[template.kind]} color={getKindBadgeColor(template.kind)} />
            </div>
            <div>
              <Badge text={template.scope} color={template.scope === 'global' ? 'orange' : 'blue'} />
            </div>
            <Text color="secondary" variant="bodySmall">
              {template.latest_version}
            </Text>
            <Text truncate color="secondary" variant="bodySmall">
              {template.description || '—'}
            </Text>
            <Text color="secondary" variant="bodySmall">
              {formatDate(template.created_at)}
            </Text>
            <div className={styles.actions}>
              {onFork && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="code-branch"
                  fill="text"
                  tooltip="Fork as evaluator"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFork(template.template_id);
                  }}
                >
                  Fork
                </Button>
              )}
              {onDelete && template.scope === 'tenant' && (
                <IconButton
                  name="trash-alt"
                  size="sm"
                  tooltip="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDeleteID(template.template_id);
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
