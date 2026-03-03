import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, Stack, Text, useStyles2 } from '@grafana/ui';
import { EVALUATOR_KIND_LABELS, formatEvaluatorId, getKindBadgeColor, type Evaluator } from '../../evaluation/types';

export type EvaluatorTemplateCardProps = {
  evaluator: Evaluator;
  onFork?: (evaluatorID: string) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '8px',
    padding: theme.spacing(2),
    background: theme.colors.background.secondary,
    minHeight: '180px',
    display: 'flex',
    flexDirection: 'column' as const,
  }),
  header: css({
    marginBottom: theme.spacing(1),
  }),
  description: css({
    flex: 1,
    marginBottom: theme.spacing(2),
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical' as const,
  }),
  footer: css({
    marginTop: 'auto',
  }),
});

export default function EvaluatorTemplateCard({ evaluator, onFork }: EvaluatorTemplateCardProps) {
  const styles = useStyles2(getStyles);

  const userPrompt = evaluator.config.user_prompt as string | undefined;
  const firstOutputKey = evaluator.output_keys[0]?.key;
  const description = userPrompt ?? firstOutputKey ?? '';

  const firstOutput = evaluator.output_keys[0];
  const outputTypeLabel = firstOutput ? firstOutput.type : '';

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
          <Text weight="medium">{formatEvaluatorId(evaluator.evaluator_id)}</Text>
          <Badge text={EVALUATOR_KIND_LABELS[evaluator.kind]} color={getKindBadgeColor(evaluator.kind)} />
          {outputTypeLabel && <Badge text={outputTypeLabel} color="blue" />}
        </Stack>
      </div>
      {description && (
        <div className={styles.description}>
          <Text color="secondary" variant="bodySmall">
            {description}
          </Text>
        </div>
      )}
      <div className={styles.footer}>
        {onFork && (
          <Button variant="secondary" size="sm" icon="code-branch" onClick={() => onFork(evaluator.evaluator_id)}>
            Fork
          </Button>
        )}
      </div>
    </div>
  );
}
