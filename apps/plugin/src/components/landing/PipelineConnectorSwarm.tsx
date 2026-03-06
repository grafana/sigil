import React from 'react';
import { css, cx, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

type PipelineSpark = {
  size: number;
  durationSec: number;
  delaySec: number;
  lanePct: number;
  curveA: number;
  curveB: number;
  curveC: number;
  opacity: number;
};

const PIPELINE_SPARKS: PipelineSpark[] = [
  { size: 3, durationSec: 0.82, delaySec: -0.04, lanePct: 6, curveA: -6, curveB: 9, curveC: -5, opacity: 0.95 },
  { size: 2, durationSec: 1.24, delaySec: -0.14, lanePct: 12, curveA: 16, curveB: -18, curveC: 14, opacity: 0.78 },
  { size: 4, durationSec: 0.9, delaySec: -0.26, lanePct: 18, curveA: -10, curveB: 13, curveC: -7, opacity: 0.9 },
  { size: 2, durationSec: 1.3, delaySec: -0.38, lanePct: 24, curveA: 20, curveB: -12, curveC: 16, opacity: 0.8 },
  { size: 3, durationSec: 0.96, delaySec: -0.52, lanePct: 30, curveA: -8, curveB: 17, curveC: -14, opacity: 0.86 },
  { size: 2, durationSec: 1.08, delaySec: -0.64, lanePct: 36, curveA: 11, curveB: -9, curveC: 8, opacity: 0.83 },
  { size: 4, durationSec: 0.88, delaySec: -0.78, lanePct: 42, curveA: -14, curveB: 6, curveC: -19, opacity: 0.93 },
  { size: 3, durationSec: 1.18, delaySec: -0.9, lanePct: 48, curveA: 18, curveB: -15, curveC: 10, opacity: 0.82 },
  { size: 2, durationSec: 0.86, delaySec: -1.02, lanePct: 54, curveA: -7, curveB: 10, curveC: -6, opacity: 0.88 },
  { size: 4, durationSec: 1.12, delaySec: -1.16, lanePct: 60, curveA: 15, curveB: -20, curveC: 17, opacity: 0.91 },
  { size: 2, durationSec: 1.22, delaySec: -1.28, lanePct: 66, curveA: -13, curveB: 8, curveC: -12, opacity: 0.79 },
  { size: 3, durationSec: 0.8, delaySec: -1.42, lanePct: 72, curveA: 9, curveB: -11, curveC: 7, opacity: 0.92 },
  { size: 4, durationSec: 1.04, delaySec: -1.56, lanePct: 78, curveA: -18, curveB: 14, curveC: -9, opacity: 0.9 },
  { size: 2, durationSec: 1.16, delaySec: -1.7, lanePct: 84, curveA: 12, curveB: -8, curveC: 19, opacity: 0.81 },
  { size: 3, durationSec: 0.92, delaySec: -1.84, lanePct: 90, curveA: -9, curveB: 16, curveC: -15, opacity: 0.89 },
  { size: 2, durationSec: 1.28, delaySec: -1.98, lanePct: 95, curveA: 17, curveB: -14, curveC: 11, opacity: 0.77 },
];

const connectorSwarmTravel = keyframes({
  '0%': { left: -12, top: 'var(--spark-lane)', opacity: 0, transform: 'translateY(-50%) scale(0.72)' },
  '16%': { opacity: 'var(--spark-opacity)' },
  '28%': { top: 'calc(var(--spark-lane) + var(--spark-curve-a))' },
  '44%': { opacity: 0.15 },
  '55%': { top: 'calc(var(--spark-lane) + var(--spark-curve-b))' },
  '62%': { opacity: 0 },
  '72%': { opacity: 'var(--spark-opacity)' },
  '80%': { top: 'calc(var(--spark-lane) + var(--spark-curve-c))' },
  '90%': { opacity: 0.25 },
  '100%': { left: 'calc(100% - 2px)', top: 'var(--spark-lane)', opacity: 0, transform: 'translateY(-50%) scale(0.6)' },
});

const connectorSwarmPulse = keyframes({
  '0%': { filter: 'brightness(0.92)' },
  '100%': { filter: 'brightness(1.25)' },
});

type PipelineConnectorSwarmProps = {
  color: string;
  delayed?: boolean;
};

export function PipelineConnectorSwarm({ color, delayed = false }: PipelineConnectorSwarmProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={cx(styles.connector, delayed && styles.connectorDelayed)} aria-hidden>
      {PIPELINE_SPARKS.map((spark, index) => (
        <div
          key={`${color}-${index}`}
          className={styles.spark}
          style={
            {
              '--spark-size': `${spark.size}px`,
              '--spark-duration': `${spark.durationSec}s`,
              '--spark-delay': `${spark.delaySec}s`,
              '--spark-lane': `${spark.lanePct}%`,
              '--spark-curve-a': `${spark.curveA}px`,
              '--spark-curve-b': `${spark.curveB}px`,
              '--spark-curve-c': `${spark.curveC}px`,
              '--spark-opacity': `${spark.opacity}`,
              backgroundColor: color,
              boxShadow: `0 0 6px 1px ${color}66`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function getStyles(): Record<string, string> {
  return {
    connector: css({
      label: 'pipelineConnectorSwarm-connector',
      position: 'relative',
      display: 'flex',
      alignItems: 'stretch',
      alignSelf: 'stretch',
      width: 54,
      height: '100%',
      flexShrink: 0,
      overflow: 'hidden',
      '@container landing-top-bar (max-width: 900px)': {
        display: 'none',
      },
    }),
    connectorDelayed: css({
      label: 'pipelineConnectorSwarm-connectorDelayed',
      '--connector-delay': '0.45s',
    }),
    spark: css({
      label: 'pipelineConnectorSwarm-spark',
      position: 'absolute',
      left: -12,
      top: '50%',
      width: 'var(--spark-size)',
      height: 'var(--spark-size)',
      borderRadius: '50%',
      opacity: 0,
      willChange: 'left, top, opacity, transform',
      animationName: `${connectorSwarmTravel}, ${connectorSwarmPulse}`,
      animationDuration: 'var(--spark-duration), 0.5s',
      animationTimingFunction: 'linear, ease-in-out',
      animationIterationCount: 'infinite, infinite',
      animationDelay: 'calc(var(--spark-delay) + var(--connector-delay, 0s)), calc(var(--spark-delay) + var(--connector-delay, 0s))',
      animationDirection: 'normal, alternate',
    }),
  };
}
