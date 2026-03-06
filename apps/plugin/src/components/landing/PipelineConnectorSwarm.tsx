import React from 'react';
import { css, cx, keyframes } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';

type PipelineSpark = {
  size: number;
  durationSec: number;
  delaySec: number;
  lanePct: number;
  startXPct: number;
  endXPct: number;
  startOpacity: number;
  curveA: number;
  curveB: number;
  curveC: number;
  curveD: number;
  curveE: number;
  opacity: number;
};

const PIPELINE_SPARKS: PipelineSpark[] = [
  {
    size: 3,
    durationSec: 0.82,
    delaySec: -0.04,
    lanePct: 6,
    startXPct: 4,
    endXPct: 28,
    startOpacity: 0.02,
    curveA: -8,
    curveB: 14,
    curveC: -6,
    curveD: 18,
    curveE: -12,
    opacity: 0.95,
  },
  {
    size: 2,
    durationSec: 1.24,
    delaySec: -0.14,
    lanePct: 12,
    startXPct: 62,
    endXPct: 88,
    startOpacity: 0.01,
    curveA: 20,
    curveB: -24,
    curveC: 16,
    curveD: -10,
    curveE: 22,
    opacity: 0.78,
  },
  {
    size: 4,
    durationSec: 0.9,
    delaySec: -0.26,
    lanePct: 18,
    startXPct: 19,
    endXPct: 53,
    startOpacity: 0.03,
    curveA: -12,
    curveB: 18,
    curveC: -11,
    curveD: 7,
    curveE: -16,
    opacity: 0.9,
  },
  {
    size: 2,
    durationSec: 1.3,
    delaySec: -0.38,
    lanePct: 24,
    startXPct: 83,
    endXPct: 57,
    startOpacity: 0.02,
    curveA: 24,
    curveB: -14,
    curveC: 18,
    curveD: -22,
    curveE: 9,
    opacity: 0.8,
  },
  {
    size: 3,
    durationSec: 0.96,
    delaySec: -0.52,
    lanePct: 30,
    startXPct: 35,
    endXPct: 76,
    startOpacity: 0.03,
    curveA: -9,
    curveB: 21,
    curveC: -18,
    curveD: 12,
    curveE: -7,
    opacity: 0.86,
  },
  {
    size: 2,
    durationSec: 1.08,
    delaySec: -0.64,
    lanePct: 36,
    startXPct: 71,
    endXPct: 44,
    startOpacity: 0.01,
    curveA: 14,
    curveB: -12,
    curveC: 9,
    curveD: -19,
    curveE: 13,
    opacity: 0.83,
  },
  {
    size: 4,
    durationSec: 0.88,
    delaySec: -0.78,
    lanePct: 42,
    startXPct: 8,
    endXPct: 37,
    startOpacity: 0.02,
    curveA: -17,
    curveB: 8,
    curveC: -23,
    curveD: 19,
    curveE: -10,
    opacity: 0.93,
  },
  {
    size: 3,
    durationSec: 1.18,
    delaySec: -0.9,
    lanePct: 48,
    startXPct: 56,
    endXPct: 92,
    startOpacity: 0.03,
    curveA: 22,
    curveB: -18,
    curveC: 11,
    curveD: -7,
    curveE: 24,
    opacity: 0.82,
  },
  {
    size: 2,
    durationSec: 0.86,
    delaySec: -1.02,
    lanePct: 54,
    startXPct: 27,
    endXPct: 11,
    startOpacity: 0.01,
    curveA: -10,
    curveB: 12,
    curveC: -8,
    curveD: 16,
    curveE: -15,
    opacity: 0.88,
  },
  {
    size: 4,
    durationSec: 1.12,
    delaySec: -1.16,
    lanePct: 60,
    startXPct: 91,
    endXPct: 65,
    startOpacity: 0.03,
    curveA: 18,
    curveB: -26,
    curveC: 20,
    curveD: -13,
    curveE: 11,
    opacity: 0.91,
  },
  {
    size: 2,
    durationSec: 1.22,
    delaySec: -1.28,
    lanePct: 66,
    startXPct: 14,
    endXPct: 49,
    startOpacity: 0.02,
    curveA: -15,
    curveB: 9,
    curveC: -14,
    curveD: 23,
    curveE: -6,
    opacity: 0.79,
  },
  {
    size: 3,
    durationSec: 0.8,
    delaySec: -1.42,
    lanePct: 72,
    startXPct: 47,
    endXPct: 73,
    startOpacity: 0.03,
    curveA: 11,
    curveB: -13,
    curveC: 8,
    curveD: -21,
    curveE: 17,
    opacity: 0.92,
  },
  {
    size: 4,
    durationSec: 1.04,
    delaySec: -1.56,
    lanePct: 78,
    startXPct: 76,
    endXPct: 39,
    startOpacity: 0.02,
    curveA: -22,
    curveB: 17,
    curveC: -12,
    curveD: 9,
    curveE: -24,
    opacity: 0.9,
  },
  {
    size: 2,
    durationSec: 1.16,
    delaySec: -1.7,
    lanePct: 84,
    startXPct: 5,
    endXPct: 24,
    startOpacity: 0.01,
    curveA: 14,
    curveB: -10,
    curveC: 23,
    curveD: -18,
    curveE: 12,
    opacity: 0.81,
  },
  {
    size: 3,
    durationSec: 0.92,
    delaySec: -1.84,
    lanePct: 90,
    startXPct: 64,
    endXPct: 52,
    startOpacity: 0.03,
    curveA: -11,
    curveB: 20,
    curveC: -17,
    curveD: 15,
    curveE: -9,
    opacity: 0.89,
  },
  {
    size: 2,
    durationSec: 1.28,
    delaySec: -1.98,
    lanePct: 95,
    startXPct: 39,
    endXPct: 86,
    startOpacity: 0.01,
    curveA: 21,
    curveB: -17,
    curveC: 13,
    curveD: -25,
    curveE: 19,
    opacity: 0.77,
  },
];

const connectorSwarmTravel = keyframes({
  '0%': {
    left: 'var(--spark-start-x, -12px)',
    top: 'var(--spark-lane)',
    opacity: 'var(--spark-start-opacity, 0)',
    transform: 'translateY(-50%) scale(0.72)',
  },
  '12%': { opacity: 'var(--spark-opacity)' },
  '20%': { top: 'calc(var(--spark-lane) + var(--spark-curve-a))' },
  '34%': { top: 'calc(var(--spark-lane) + var(--spark-curve-d))' },
  '44%': { opacity: 0.15 },
  '52%': { top: 'calc(var(--spark-lane) + var(--spark-curve-b))' },
  '62%': { opacity: 0 },
  '68%': { top: 'calc(var(--spark-lane) + var(--spark-curve-e))' },
  '72%': { opacity: 'var(--spark-opacity)' },
  '82%': { top: 'calc(var(--spark-lane) + var(--spark-curve-c))' },
  '90%': { opacity: 0.25 },
  '100%': {
    left: 'var(--spark-end-x, calc(100% - 2px))',
    top: 'var(--spark-lane)',
    opacity: 0,
    transform: 'translateY(-50%) scale(0.6)',
  },
});

const connectorSwarmPulse = keyframes({
  '0%': { filter: 'var(--spark-filter-start, brightness(0.92))' },
  '100%': { filter: 'var(--spark-filter-end, brightness(1.25))' },
});

type PipelineConnectorSwarmProps = {
  color: string;
  delayed?: boolean;
  mode?: 'connector' | 'section';
  className?: string;
  delaySec?: number;
  sizeScale?: number;
  durationScale?: number;
  seed?: number;
};

function seededUnit(seed: number, index: number, salt: number): number {
  const value = Math.sin((seed + 1) * 12.9898 + (index + 1) * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function clampPercent(value: number): number {
  return Math.max(2, Math.min(98, value));
}

export function PipelineConnectorSwarm({
  color,
  delayed = false,
  mode = 'connector',
  className,
  delaySec,
  sizeScale,
  durationScale,
  seed,
}: PipelineConnectorSwarmProps) {
  const styles = useStyles2(getStyles);
  const connectorDelay = delaySec ?? (delayed ? 0.45 : 0);
  const effectiveSizeScale = sizeScale ?? (mode === 'section' ? 6.5 : 1);
  const effectiveDurationScale = durationScale ?? (mode === 'section' ? 12 : 1);
  const effectiveBlurPx = mode === 'section' ? 1.8 : 0;
  const effectiveGlowBlurPx = mode === 'section' ? 14 : 6;
  const effectiveGlowSpreadPx = mode === 'section' ? 4 : 1;
  const effectiveGlowAlpha = mode === 'section' ? '88' : '66';
  const seededSparks = React.useMemo(() => {
    if (seed == null || mode !== 'section') {
      return PIPELINE_SPARKS;
    }
    const randomRange = (index: number, salt: number, min: number, max: number): number =>
      min + seededUnit(seed, index, salt) * (max - min);

    return PIPELINE_SPARKS.map((spark, index) => {
      const lanePct = randomRange(index, 1, 2, 98);
      const startXPct = randomRange(index, 2, 2, 98);
      const endXPct = randomRange(index, 3, 2, 98);
      const delaySec = -randomRange(index, 4, 0, 4.5);
      const startOpacity = randomRange(index, 5, 0, 0.22);
      const opacity = randomRange(index, 6, 0.3, 1);
      const size = spark.size * randomRange(index, 7, 0.7, 1.35);
      const durationSec = spark.durationSec * randomRange(index, 8, 0.75, 1.4);

      return {
        ...spark,
        lanePct: clampPercent(lanePct),
        startXPct: clampPercent(startXPct),
        endXPct: clampPercent(endXPct),
        delaySec,
        startOpacity,
        opacity,
        size,
        durationSec,
        curveA: randomRange(index, 9, -30, 30),
        curveB: randomRange(index, 10, -30, 30),
        curveC: randomRange(index, 11, -30, 30),
        curveD: randomRange(index, 12, -30, 30),
        curveE: randomRange(index, 13, -30, 30),
      };
    });
  }, [mode, seed]);

  return (
    <div
      className={cx(styles.connector, mode === 'section' && styles.section, className)}
      style={
        {
          '--connector-delay': `${connectorDelay}s`,
        } as React.CSSProperties
      }
      aria-hidden
    >
      {seededSparks.map((spark, index) => (
        <div
          key={`${color}-${index}`}
          className={styles.spark}
          style={
            {
              '--spark-size': `${spark.size * effectiveSizeScale}px`,
              '--spark-duration': `${spark.durationSec * effectiveDurationScale}s`,
              '--spark-delay': `${spark.delaySec}s`,
              '--spark-lane': `${spark.lanePct}%`,
              '--spark-start-x': mode === 'section' ? `${spark.startXPct}%` : undefined,
              '--spark-end-x': mode === 'section' ? `${spark.endXPct}%` : undefined,
              '--spark-start-opacity': mode === 'section' ? `${spark.startOpacity}` : undefined,
              '--spark-curve-a': `${spark.curveA}px`,
              '--spark-curve-b': `${spark.curveB}px`,
              '--spark-curve-c': `${spark.curveC}px`,
              '--spark-curve-d': `${spark.curveD}px`,
              '--spark-curve-e': `${spark.curveE}px`,
              '--spark-opacity': `${spark.opacity}`,
              '--spark-filter-start': `blur(${effectiveBlurPx}px) brightness(0.92)`,
              '--spark-filter-end': `blur(${effectiveBlurPx}px) brightness(1.25)`,
              backgroundColor: color,
              boxShadow: `0 0 ${effectiveGlowBlurPx}px ${effectiveGlowSpreadPx}px ${color}${effectiveGlowAlpha}`,
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
    section: css({
      label: 'pipelineConnectorSwarm-section',
      position: 'absolute',
      inset: 0,
      width: '100%',
      zIndex: 0,
      pointerEvents: 'none',
      opacity: 0.45,
      '@container landing-top-bar (max-width: 900px)': {
        display: 'block',
      },
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
      animationDelay:
        'calc(var(--spark-delay) + var(--connector-delay, 0s)), calc(var(--spark-delay) + var(--connector-delay, 0s))',
      animationDirection: 'normal, alternate',
    }),
  };
}
