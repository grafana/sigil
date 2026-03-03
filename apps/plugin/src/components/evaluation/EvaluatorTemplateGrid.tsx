import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { Evaluator } from '../../evaluation/types';
import EvaluatorTemplateCard from './EvaluatorTemplateCard';

export type EvaluatorTemplateGridProps = {
  evaluators: Evaluator[];
  onFork?: (evaluatorID: string) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  grid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: theme.spacing(2),
  }),
});

export default function EvaluatorTemplateGrid({ evaluators, onFork }: EvaluatorTemplateGridProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.grid}>
      {evaluators.map((evaluator) => (
        <EvaluatorTemplateCard key={evaluator.evaluator_id} evaluator={evaluator} onFork={onFork} />
      ))}
    </div>
  );
}
