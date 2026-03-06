import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, ConfirmModal, IconButton, Stack, Text, useStyles2 } from '@grafana/ui';
import { EVALUATOR_KIND_LABELS, getKindBadgeColor, type Evaluator } from '../../evaluation/types';

export type EvaluatorCardGridProps = {
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
  grid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: theme.spacing(1.5),
  }),
  card: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    minHeight: 190,
    padding: theme.spacing(1.5),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
    boxShadow: 'inset 3px 0 0 rgba(61, 113, 217, 0.28)',
    background: theme.colors.background.secondary,
    cursor: 'pointer',
    transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
    '&:hover': {
      borderColor: theme.colors.border.strong,
      boxShadow: `inset 3px 0 0 rgba(61, 113, 217, 0.42), ${theme.shadows.z1}`,
      transform: 'translateY(-1px)',
    },
  }),
  header: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.75),
    minWidth: 0,
  }),
  title: css({
    minWidth: 0,
  }),
  meta: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.75),
  }),
  metaText: css({
    color: theme.colors.text.secondary,
    fontSize: '11px',
    lineHeight: 1.4,
  }),
  description: css({
    minHeight: theme.spacing(5.5),
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
  }),
  footer: css({
    marginTop: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(0.75),
  }),
  footerActions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.375),
  }),
});

export default function EvaluatorCardGrid({ evaluators, onSelect, onDelete }: EvaluatorCardGridProps) {
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
      <div className={styles.grid}>
        {evaluators.map((evaluator) => (
          <div
            key={evaluator.evaluator_id}
            className={styles.card}
            onClick={() => onSelect?.(evaluator.evaluator_id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(evaluator.evaluator_id);
              }
            }}
          >
            <div className={styles.header}>
              <div className={styles.title}>
                <Text weight="medium" truncate>
                  {evaluator.evaluator_id}
                </Text>
              </div>
              <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
                <Badge text={EVALUATOR_KIND_LABELS[evaluator.kind]} color={getKindBadgeColor(evaluator.kind)} />
                {evaluator.output_keys.map((ok) => (
                  <Badge key={ok.key} text={ok.type} color="blue" />
                ))}
              </Stack>
            </div>

            <div className={styles.meta}>
              <span className={styles.metaText}>Version {evaluator.version}</span>
              <span className={styles.metaText}>Created {formatDate(evaluator.created_at)}</span>
            </div>

            <div className={styles.description}>
              <Text color="secondary" variant="bodySmall">
                {evaluator.description || '—'}
              </Text>
            </div>
            <div className={styles.footer}>
              <div className={styles.footerActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect?.(evaluator.evaluator_id);
                  }}
                >
                  Edit
                </Button>
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
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
