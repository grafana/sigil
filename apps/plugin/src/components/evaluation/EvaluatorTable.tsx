import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, IconButton, Text, useStyles2 } from '@grafana/ui';
import { EVALUATOR_KIND_LABELS, getKindBadgeColor, type Evaluator } from '../../evaluation/types';

export type EvaluatorTableProps = {
  evaluators: Evaluator[];
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
    gridTemplateColumns: '1fr auto auto auto auto auto',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    background: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.medium}`,
    alignItems: 'center',
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: '1fr auto auto auto auto auto',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 2),
    alignItems: 'center',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  outputKeys: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
  }),
});

export default function EvaluatorTable({ evaluators, onSelect, onDelete }: EvaluatorTableProps) {
  const styles = useStyles2(getStyles);

  return (
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
          className={styles.row}
          onClick={() => onSelect?.(evaluator.evaluator_id)}
          role="row"
        >
          <Text truncate>{evaluator.evaluator_id}</Text>
          <Badge text={EVALUATOR_KIND_LABELS[evaluator.kind]} color={getKindBadgeColor(evaluator.kind)} />
          <Text color="secondary" variant="bodySmall">
            {evaluator.version}
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
                onDelete(evaluator.evaluator_id);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
