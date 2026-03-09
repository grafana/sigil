import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, ConfirmModal, IconButton, Text, useStyles2 } from '@grafana/ui';
import { EVALUATOR_KIND_LABELS, getKindBadgeColor, type TemplateDefinition } from '../../evaluation/types';
import DataTable, { type ColumnDef } from '../shared/DataTable';

export type TemplateTableProps = {
  templates: TemplateDefinition[];
  onSelect?: (templateID: string) => void;
  onDelete?: (templateID: string) => void;
  onFork?: (templateID: string) => void;
};

function formatDate(iso: string): string {
  if (!iso) {
    return '—';
  }
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() <= 1) {
      return '—';
    }
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

const getStyles = (theme: GrafanaTheme2) => ({
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

  const columns = useMemo(() => {
    const cols: Array<ColumnDef<TemplateDefinition>> = [
      {
        id: 'template',
        header: 'Template',
        width: 230,
        cell: (template: TemplateDefinition) => (
          <div className={styles.templateId}>
            <Text weight="medium" truncate>
              {template.template_id}
            </Text>
          </div>
        ),
      },
      {
        id: 'kind',
        header: 'Kind',
        width: 125,
        cell: (template: TemplateDefinition) => (
          <Badge text={EVALUATOR_KIND_LABELS[template.kind]} color={getKindBadgeColor(template.kind)} />
        ),
      },
      {
        id: 'scope',
        header: 'Scope',
        width: 80,
        cell: (template: TemplateDefinition) => (
          <Badge text={template.scope} color={template.scope === 'global' ? 'orange' : 'blue'} />
        ),
      },
      {
        id: 'version',
        header: 'Version',
        width: 140,
        cell: (template: TemplateDefinition) => (
          <Text color="secondary" variant="bodySmall">
            {template.latest_version}
          </Text>
        ),
      },
      {
        id: 'description',
        header: 'Description',
        minWidth: 120,
        cell: (template: TemplateDefinition) => (
          <Text color="secondary" variant="bodySmall" truncate>
            {template.description || '—'}
          </Text>
        ),
      },
      {
        id: 'created',
        header: 'Created',
        width: 120,
        cell: (template: TemplateDefinition) => (
          <Text color="secondary" variant="bodySmall">
            {formatDate(template.created_at)}
          </Text>
        ),
      },
    ];

    if (onFork || onDelete) {
      cols.push({
        id: 'actions',
        header: '',
        width: 80,
        align: 'right' as const,
        cell: (template: TemplateDefinition) => (
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
        ),
      });
    }

    return cols;
  }, [onFork, onDelete, styles.templateId, styles.actions]);

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
      <DataTable<TemplateDefinition>
        columns={columns}
        data={templates}
        keyOf={(t) => t.template_id}
        onRowClick={onSelect ? (template) => onSelect(template.template_id) : undefined}
        rowVariant={(template) => (template.scope === 'global' ? 'warning' : 'info')}
        fixedLayout
      />
    </>
  );
}
