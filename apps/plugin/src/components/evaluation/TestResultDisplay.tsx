import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Text, useStyles2 } from '@grafana/ui';
import type { EvalTestResponse } from '../../evaluation/types';

export type TestResultDisplayProps = {
  result: EvalTestResponse;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1.5),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  meta: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }),
  scoreRow: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
    padding: theme.spacing(1),
    background: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  scoreHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  explanation: css({
    whiteSpace: 'pre-wrap' as const,
    fontSize: theme.typography.size.sm,
    color: theme.colors.text.secondary,
  }),
});

export default function TestResultDisplay({ result }: TestResultDisplayProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.container}>
      <div className={styles.meta}>
        <Text variant="bodySmall" color="secondary">
          Generation: {result.generation_id}
        </Text>
        <Text variant="bodySmall" color="secondary">
          {result.execution_time_ms}ms
        </Text>
      </div>
      {result.scores.map((score) => (
        <div key={score.key} className={styles.scoreRow}>
          <div className={styles.scoreHeader}>
            <Text weight="medium">{score.key}</Text>
            <Badge text={String(score.value)} color={score.passed === false ? 'red' : 'green'} />
            <Text variant="bodySmall" color="secondary">
              ({score.type})
            </Text>
            {score.passed != null && (
              <Badge text={score.passed ? 'PASS' : 'FAIL'} color={score.passed ? 'green' : 'red'} />
            )}
          </div>
          {score.explanation && <div className={styles.explanation}>{score.explanation}</div>}
        </div>
      ))}
    </div>
  );
}
