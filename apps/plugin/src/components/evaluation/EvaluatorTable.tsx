import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, ConfirmModal, IconButton, Text, useStyles2 } from '@grafana/ui';
import DataTable, { type ColumnDef } from '../shared/DataTable';
import { EVALUATOR_KIND_LABELS, getKindBadgeColor, type Evaluator } from '../../evaluation/types';

export type EvaluatorTableProps = {
  evaluators: Evaluator[];
  selectedEvaluatorID?: string | null;
  onSelect?: (evaluatorID: string) => void;
  onDelete?: (evaluatorID: string) => void;
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
  evaluatorId: css({
    minWidth: 0,
  }),
  outputKeys: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
    minWidth: 0,
  }),
});

export default function EvaluatorTable({ evaluators, selectedEvaluatorID, onSelect, onDelete }: EvaluatorTableProps) {
  const styles = useStyles2(getStyles);
  const [pendingDeleteID, setPendingDeleteID] = useState<string | null>(null);

  const columns = useMemo(() => {
    const cols: Array<ColumnDef<Evaluator>> = [
      {
        id: 'evaluator_id',
        header: 'Evaluator ID',
        width: 240,
        cell: (evaluator: Evaluator) => (
          <div className={styles.evaluatorId}>
            <Text weight="medium" truncate>
              {evaluator.evaluator_id}
            </Text>
          </div>
        ),
      },
      {
        id: 'kind',
        header: 'Kind',
        width: 125,
        cell: (evaluator: Evaluator) => (
          <Badge text={EVALUATOR_KIND_LABELS[evaluator.kind]} color={getKindBadgeColor(evaluator.kind)} />
        ),
      },
      {
        id: 'version',
        header: 'Version',
        width: 140,
        cell: (evaluator: Evaluator) => (
          <Text color="secondary" variant="bodySmall">
            {evaluator.version}
          </Text>
        ),
      },
      {
        id: 'description',
        header: 'Description',
        minWidth: 120,
        cell: (evaluator: Evaluator) => (
          <Text color="secondary" variant="bodySmall" truncate>
            {evaluator.description || '—'}
          </Text>
        ),
      },
      {
        id: 'output_keys',
        header: 'Output keys',
        width: 210,
        cell: (evaluator: Evaluator) => (
          <div className={styles.outputKeys}>
            {evaluator.output_keys.map((ok) => (
              <Badge key={ok.key} text={`${ok.key}: ${ok.type}`} color="blue" />
            ))}
          </div>
        ),
      },
      {
        id: 'created',
        header: 'Created',
        width: 120,
        cell: (evaluator: Evaluator) => (
          <Text color="secondary" variant="bodySmall">
            {formatDate(evaluator.created_at)}
          </Text>
        ),
      },
    ];

    if (onDelete) {
      cols.push({
        id: 'actions',
        header: '',
        width: 56,
        cell: (evaluator: Evaluator) => (
          <IconButton
            name="trash-alt"
            tooltip="Delete"
            onClick={(e) => {
              e.stopPropagation();
              setPendingDeleteID(evaluator.evaluator_id);
            }}
          />
        ),
      });
    }

    return cols;
  }, [onDelete, styles.evaluatorId, styles.outputKeys]);

  return (
    <>
      <ConfirmModal
        isOpen={pendingDeleteID !== null}
        title="Delete evaluator"
        body={`Are you sure you want to delete evaluator "${pendingDeleteID}"? This cannot be undone.`}
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
      <DataTable<Evaluator>
        columns={columns}
        data={evaluators}
        keyOf={(e) => e.evaluator_id}
        onRowClick={onSelect ? (evaluator, _e) => onSelect(evaluator.evaluator_id) : undefined}
        isSelected={selectedEvaluatorID != null ? (e) => selectedEvaluatorID === e.evaluator_id : undefined}
        fixedLayout
      />
    </>
  );
}
