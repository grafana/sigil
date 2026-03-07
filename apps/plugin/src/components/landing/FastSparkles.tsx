import React from 'react';
import { css, cx, keyframes } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';

type Spark = {
  size: number;
  durationSec: number;
  delaySec: number;
  lanePct: number;
  startXPct: number;
  startOpacity: number;
  curveA: number;
  curveB: number;
  curveC: number;
  curveD: number;
  curveE: number;
  opacity: number;
};

const BASE_SPARKS: Spark[] = [
  { size: 3, durationSec: 0.82, delaySec: -0.04, lanePct: 6, startXPct: 4, startOpacity: 0.02, curveA: -8, curveB: 14, curveC: -6, curveD: 18, curveE: -12, opacity: 0.95 },
  { size: 2, durationSec: 1.24, delaySec: -0.14, lanePct: 12, startXPct: 62, startOpacity: 0.01, curveA: 20, curveB: -24, curveC: 16, curveD: -10, curveE: 22, opacity: 0.78 },
  { size: 4, durationSec: 0.9, delaySec: -0.26, lanePct: 18, startXPct: 19, startOpacity: 0.03, curveA: -12, curveB: 18, curveC: -11, curveD: 7, curveE: -16, opacity: 0.9 },
  { size: 2, durationSec: 1.3, delaySec: -0.38, lanePct: 24, startXPct: 83, startOpacity: 0.02, curveA: 24, curveB: -14, curveC: 18, curveD: -22, curveE: 9, opacity: 0.8 },
  { size: 3, durationSec: 0.96, delaySec: -0.52, lanePct: 30, startXPct: 35, startOpacity: 0.03, curveA: -9, curveB: 21, curveC: -18, curveD: 12, curveE: -7, opacity: 0.86 },
  { size: 2, durationSec: 1.08, delaySec: -0.64, lanePct: 36, startXPct: 71, startOpacity: 0.01, curveA: 14, curveB: -12, curveC: 9, curveD: -19, curveE: 13, opacity: 0.83 },
  { size: 4, durationSec: 0.88, delaySec: -0.78, lanePct: 42, startXPct: 8, startOpacity: 0.02, curveA: -17, curveB: 8, curveC: -23, curveD: 19, curveE: -10, opacity: 0.93 },
  { size: 3, durationSec: 1.18, delaySec: -0.9, lanePct: 48, startXPct: 56, startOpacity: 0.03, curveA: 22, curveB: -18, curveC: 11, curveD: -7, curveE: 24, opacity: 0.82 },
  { size: 2, durationSec: 0.86, delaySec: -1.02, lanePct: 54, startXPct: 27, startOpacity: 0.01, curveA: -10, curveB: 12, curveC: -8, curveD: 16, curveE: -15, opacity: 0.88 },
  { size: 4, durationSec: 1.12, delaySec: -1.16, lanePct: 60, startXPct: 91, startOpacity: 0.03, curveA: 18, curveB: -26, curveC: 20, curveD: -13, curveE: 11, opacity: 0.91 },
  { size: 2, durationSec: 1.22, delaySec: -1.28, lanePct: 66, startXPct: 14, startOpacity: 0.02, curveA: -15, curveB: 9, curveC: -14, curveD: 23, curveE: -6, opacity: 0.79 },
  { size: 3, durationSec: 0.8, delaySec: -1.42, lanePct: 72, startXPct: 47, startOpacity: 0.03, curveA: 11, curveB: -13, curveC: 8, curveD: -21, curveE: 17, opacity: 0.92 },
  { size: 4, durationSec: 1.04, delaySec: -1.56, lanePct: 78, startXPct: 76, startOpacity: 0.02, curveA: -22, curveB: 17, curveC: -12, curveD: 9, curveE: -24, opacity: 0.9 },
  { size: 2, durationSec: 1.16, delaySec: -1.7, lanePct: 84, startXPct: 5, startOpacity: 0.01, curveA: 14, curveB: -10, curveC: 23, curveD: -18, curveE: 12, opacity: 0.81 },
  { size: 3, durationSec: 0.92, delaySec: -1.84, lanePct: 90, startXPct: 64, startOpacity: 0.03, curveA: -11, curveB: 20, curveC: -17, curveD: 15, curveE: -9, opacity: 0.89 },
  { size: 2, durationSec: 1.28, delaySec: -1.98, lanePct: 95, startXPct: 39, startOpacity: 0.01, curveA: 21, curveB: -17, curveC: 13, curveD: -25, curveE: 19, opacity: 0.77 },
];

const fireflyHover = keyframes({
  '0%': {
    left: 'var(--spark-start-x, 50%)',
    top: 'var(--spark-lane, 50%)',
    opacity: 'var(--spark-start-opacity, 0)',
    transform: 'translate(-50%, -50%) scale(0.82)',
  },
  '20%': {
    left: 'calc(var(--spark-start-x, 50%) + var(--spark-curve-a))',
    top: 'calc(var(--spark-lane, 50%) + var(--spark-curve-b))',
    opacity: 'var(--spark-opacity)',
    transform: 'translate(-50%, -50%) scale(1)',
  },
  '45%': {
    left: 'calc(var(--spark-start-x, 50%) + var(--spark-curve-c))',
    top: 'calc(var(--spark-lane, 50%) + var(--spark-curve-d))',
    opacity: 'calc(var(--spark-opacity) * 0.55)',
  },
  '70%': {
    left: 'calc(var(--spark-start-x, 50%) + var(--spark-curve-e))',
    top: 'calc(var(--spark-lane, 50%) + var(--spark-curve-a))',
    opacity: 'var(--spark-opacity)',
  },
  '100%': {
    left: 'var(--spark-start-x, 50%)',
    top: 'var(--spark-lane, 50%)',
    opacity: 'var(--spark-start-opacity, 0)',
    transform: 'translate(-50%, -50%) scale(0.82)',
  },
});

const pulse = keyframes({
  '0%': { filter: 'var(--spark-filter-start, brightness(0.92))' },
  '100%': { filter: 'var(--spark-filter-end, brightness(1.25))' },
});

function seededUnit(seed: number, index: number, salt: number): number {
  const value = Math.sin((seed + 1) * 12.9898 + (index + 1) * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function clampPercent(value: number): number {
  return Math.max(2, Math.min(98, value));
}

type FastSparklesProps = {
  color: string;
  className?: string;
  delaySec?: number;
  sizeScale?: number;
  durationScale?: number;
  seed?: number;
  maxSparks?: number;
  withGlow?: boolean;
};

export function FastSparkles({
  color,
  className,
  delaySec = 0,
  sizeScale = 1,
  durationScale = 1,
  seed = 1,
  maxSparks,
  withGlow = true,
}: FastSparklesProps) {
  const styles = useStyles2(getStyles);
  const sparks = React.useMemo(() => {
    const randomRange = (index: number, salt: number, min: number, max: number): number =>
      min + seededUnit(seed, index, salt) * (max - min);

    const transformed = BASE_SPARKS.map((spark, index) => ({
      ...spark,
      lanePct: clampPercent(randomRange(index, 40, 4, 96)),
      startXPct: clampPercent(randomRange(index, 41, 2, 98)),
      startOpacity: randomRange(index, 42, 0.02, 0.24),
      opacity: randomRange(index, 43, 0.5, 1),
      delaySec: -randomRange(index, 44, 0, 6.8),
      durationSec: spark.durationSec * randomRange(index, 45, 1.2, 2.25),
      size: spark.size * randomRange(index, 46, 0.9, 1.5),
      curveA: randomRange(index, 47, -28, 28),
      curveB: randomRange(index, 48, -22, 22),
      curveC: randomRange(index, 49, -30, 30),
      curveD: randomRange(index, 50, -22, 22),
      curveE: randomRange(index, 51, -28, 28),
    }));

    if (typeof maxSparks === 'number' && Number.isFinite(maxSparks) && maxSparks > 0) {
      return transformed.slice(0, Math.floor(maxSparks));
    }
    return transformed;
  }, [maxSparks, seed]);

  return (
    <div className={cx(styles.root, className)} style={{ '--connector-delay': `${delaySec}s` } as React.CSSProperties} aria-hidden>
      {sparks.map((spark, index) => (
        <div
          key={`${color}-${index}`}
          className={styles.spark}
          style={
            {
              '--spark-size': `${spark.size * sizeScale}px`,
              '--spark-duration': `${spark.durationSec * durationScale}s`,
              '--spark-delay': `${spark.delaySec}s`,
              '--spark-lane': `${spark.lanePct}%`,
              '--spark-start-x': `${spark.startXPct}%`,
              '--spark-start-opacity': `${spark.startOpacity}`,
              '--spark-curve-a': `${spark.curveA}px`,
              '--spark-curve-b': `${spark.curveB}px`,
              '--spark-curve-c': `${spark.curveC}px`,
              '--spark-curve-d': `${spark.curveD}px`,
              '--spark-curve-e': `${spark.curveE}px`,
              '--spark-opacity': `${spark.opacity}`,
              '--spark-filter-start': 'blur(0.7px) brightness(0.92)',
              '--spark-filter-end': 'blur(1.1px) brightness(1.25)',
              backgroundColor: color,
              boxShadow: withGlow ? `0 0 6px 1px ${color}66` : 'none',
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function getStyles(): Record<string, string> {
  return {
    root: css({
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      overflow: 'visible',
    }),
    spark: css({
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: 'var(--spark-size)',
      height: 'var(--spark-size)',
      borderRadius: '50%',
      opacity: 0,
      willChange: 'left, top, opacity, transform',
      animationName: `${fireflyHover}, ${pulse}`,
      animationDuration: 'var(--spark-duration), 0.6s',
      animationTimingFunction: 'ease-in-out, ease-in-out',
      animationIterationCount: 'infinite, infinite',
      animationDelay:
        'calc(var(--spark-delay) + var(--connector-delay, 0s)), calc(var(--spark-delay) + var(--connector-delay, 0s))',
      animationDirection: 'normal, alternate',
    }),
  };
}
