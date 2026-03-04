// Ported from Grafana's TraceView (Apache 2.0)

import { css, cx } from '@emotion/css';
import React from 'react';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import { formatDuration } from './formatDuration';
import type { TNil } from './types';

const getStyles = (theme: GrafanaTheme2) => ({
  Ticks: css({
    pointerEvents: 'none',
  }),
  TicksTick: css({
    position: 'absolute',
    height: '100%',
    width: '1px',
    background: theme.colors.border.weak,
    '&:last-child': {
      width: 0,
    },
  }),
  TicksTickLabel: css({
    left: '0.25rem',
    position: 'absolute',
    whiteSpace: 'nowrap',
  }),
  TicksTickLabelEndAnchor: css({
    left: 'initial',
    right: '0.25rem',
  }),
});

type TicksProps = {
  endTime?: number | TNil;
  numTicks: number;
  showLabels?: boolean | TNil;
  startTime?: number | TNil;
};

export default function Ticks({ endTime = null, numTicks, showLabels = null, startTime = null }: TicksProps) {
  let labels: undefined | string[];
  if (showLabels) {
    labels = [];
    const viewingDuration = (endTime || 0) - (startTime || 0);
    for (let i = 0; i < numTicks; i++) {
      const durationAtTick = (startTime || 0) + (i / (numTicks - 1)) * viewingDuration;
      labels.push(formatDuration(durationAtTick));
    }
  }
  const styles = useStyles2(getStyles);
  const ticks: React.ReactNode[] = [];
  for (let i = 0; i < numTicks; i++) {
    const portion = i / (numTicks - 1);
    ticks.push(
      <div key={portion} className={styles.TicksTick} style={{ left: `${portion * 100}%` }}>
        {labels && (
          <span className={cx(styles.TicksTickLabel, { [styles.TicksTickLabelEndAnchor]: portion >= 1 })}>
            {labels[i]}
          </span>
        )}
      </div>
    );
  }
  return <div className={styles.Ticks}>{ticks}</div>;
}
