import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, ConfirmModal, IconButton, Text, useStyles2 } from '@grafana/ui';
import { EVALUATOR_KIND_LABELS, getKindBadgeColor, type Evaluator } from '../../evaluation/types';

export type EvaluatorTableProps = {
  evaluators: Evaluator[];
  selectedEvaluatorID?: string | null;
  onSelect?: (evaluatorID: string) => void;
  onDelete?: (evaluatorID: string) => void;
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
    gridTemplateColumns: 'minmax(0, 2.5fr) 100px minmax(120px, 140px) minmax(0, 3fr) minmax(0, 160px) 120px 40px',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.medium}`,
    alignItems: 'center',
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2.5fr) 100px minmax(120px, 140px) minmax(0, 3fr) minmax(0, 160px) 120px 40px',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    alignItems: 'center',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    '& > *': {
      minWidth: 0,
    },
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  rowSelected: css({
    background: theme.colors.action.hover,
  }),
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
      <div className={styles.table}>
        <div className={styles.header}>
          <Text weight="medium" variant="bodySmall">
            Evaluator ID
          </Text>
          <Text weight="medium" variant="bodySmall">
            Kind
          </Text>
          <Text weight="medium" variant="bodySmall">
            Version
          </Text>
          <Text weight="medium" variant="bodySmall">
            Description
          </Text>
          <Text weight="medium" variant="bodySmall">
            Output keys
          </Text>
          <Text weight="medium" variant="bodySmall">
            Created
          </Text>
          <div />
        </div>
        {evaluators.map((evaluator) => (
          <div
            key={evaluator.evaluator_id}
            className={
              selectedEvaluatorID === evaluator.evaluator_id ? `${styles.row} ${styles.rowSelected}` : styles.row
            }
            onClick={() => onSelect?.(evaluator.evaluator_id)}
            role="row"
          >
            <div className={styles.evaluatorId}>
              <Text truncate>{evaluator.evaluator_id}</Text>
            </div>
            <div>
              <Badge text={EVALUATOR_KIND_LABELS[evaluator.kind]} color={getKindBadgeColor(evaluator.kind)} />
            </div>
            <Text color="secondary" variant="bodySmall">
              {evaluator.version}
            </Text>
            <Text color="secondary" variant="bodySmall" truncate>
              {evaluator.description || '—'}
            </Text>
            <div className={styles.outputKeys}>
              {evaluator.output_keys.map((ok) => (
                <Badge key={ok.key} text={`${ok.key}: ${ok.type}`} color="blue" />
              ))}
            </div>
            <Text color="secondary" variant="bodySmall">
              {formatDate(evaluator.created_at)}
            </Text>
            {onDelete && (
              <IconButton
                name="trash-alt"
                tooltip="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDeleteID(evaluator.evaluator_id);
                }}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
