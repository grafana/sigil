import React, { useEffect, useMemo, useState } from 'react';
import { css, keyframes } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

const DEFAULT_TYPEWRITER_LINES = [
  'Crunching telemetry data...',
  'Analyzing AI traces...',
  'Decoding telemetry patterns...',
  'Sifting through span events...',
  'Correlating logs and traces...',
  'Mapping service dependencies...',
  'Indexing conversation spans...',
  'Sampling high-latency traces...',
  'Scanning OTLP payloads...',
  'Calculating p95 response times...',
  'Resolving trace-to-log links...',
  'Grouping errors by service...',
  'Comparing current and baseline windows...',
  'Checking exemplar breadcrumbs...',
  'Enriching spans with metadata...',
  'Summarizing token usage telemetry...',
  'Inspecting agent call chains...',
  'Building timeline overlays...',
  'Tagging anomalous request paths...',
  'Aggregating metrics by dimension...',
  'Preparing Grafana observability insights...',
];
const TYPE_STEP_MS = 45;
const DELETE_STEP_MS = 24;
const FULL_LINE_PAUSE_MS = 1800;
const EMPTY_LINE_PAUSE_MS = 260;

type LoaderProps = {
  showText?: boolean;
  lines?: string[];
  align?: 'center' | 'left';
};

export const Loader = ({ showText = true, lines, align = 'center' }: LoaderProps) => {
  const styles = useStyles2(getStyles);
  const activeLines = useMemo(() => (lines && lines.length > 0 ? lines : DEFAULT_TYPEWRITER_LINES), [lines]);
  const typewriterKey = useMemo(() => activeLines.join('\n'), [activeLines]);

  return (
    <div className={align === 'left' ? styles.rootLeft : styles.root}>
      <div className={styles.container} role="progressbar" aria-label="loading conversation">
        <span className={styles.bar}></span>
        <span className={styles.bar}></span>
        <span className={styles.bar}></span>
        <span className={styles.bar}></span>
        <span className={styles.bar}></span>
        <span className={styles.particle}></span>
        <span className={styles.particle}></span>
        <span className={styles.particle}></span>
        <span className={styles.particle}></span>
        <span className={styles.particle}></span>
      </div>
      {showText ? <Typewriter key={typewriterKey} lines={activeLines} /> : null}
    </div>
  );
};

type TypewriterProps = {
  lines: string[];
};

const Typewriter = ({ lines }: TypewriterProps) => {
  const styles = useStyles2(getStyles);
  const [lineIndex, setLineIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const normalizedLineIndex = lineIndex % lines.length;

  const currentLine = useMemo(() => lines[normalizedLineIndex] ?? '', [lines, normalizedLineIndex]);

  useEffect(() => {
    const atLineEnd = charCount >= currentLine.length;
    const atLineStart = charCount === 0;

    const timeout = window.setTimeout(
      () => {
        if (!isDeleting && !atLineEnd) {
          setCharCount((count) => count + 1);
          return;
        }

        if (!isDeleting && atLineEnd) {
          setIsDeleting(true);
          return;
        }

        if (isDeleting && !atLineStart) {
          setCharCount((count) => Math.max(0, count - 1));
          return;
        }

        setIsDeleting(false);
        setLineIndex((index) => (index + 1) % lines.length);
      },
      atLineEnd && !isDeleting
        ? FULL_LINE_PAUSE_MS
        : atLineStart && isDeleting
          ? EMPTY_LINE_PAUSE_MS
          : isDeleting
            ? DELETE_STEP_MS
            : TYPE_STEP_MS
    );

    return () => {
      window.clearTimeout(timeout);
    };
  }, [lines.length, charCount, currentLine.length, isDeleting]);

  return (
    <div className={styles.typewriterRow} aria-live="polite">
      <span>{currentLine.slice(0, charCount)}</span>
      <span className={styles.cursor}>|</span>
    </div>
  );
};

const getPulse = (theme: GrafanaTheme2, startHeight: number, maxHeight: number) =>
  keyframes({
    '0%': {
      height: theme.spacing(startHeight),
      opacity: 0.7,
    },
    '25%': {
      height: theme.spacing(maxHeight),
      opacity: 1,
    },
    '50%': {
      height: theme.spacing(startHeight * 0.8),
      opacity: 0.8,
    },
    '75%': {
      height: theme.spacing(maxHeight * 0.9),
      opacity: 0.9,
    },
    '100%': {
      height: theme.spacing(startHeight),
      opacity: 0.7,
    },
  });

const getSparkle = () =>
  keyframes({
    '0%': {
      transform: 'translate(0, 0) scale(1)',
      opacity: 0,
    },
    '20%': {
      opacity: 1,
    },
    '100%': {
      transform: 'translate(var(--tx), var(--ty)) scale(0)',
      opacity: 0,
    },
  });

const blink = keyframes({
  '0%, 50%': { opacity: 1 },
  '50.01%, 100%': { opacity: 0 },
});

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  }),
  rootLeft: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
  }),
  container: css({
    display: 'flex',
    flexDirection: 'row' as const,
    gap: theme.spacing(0.25),
    padding: theme.spacing(0.5, 0.5, 0, 0.5),
    margin: theme.spacing(2, 0),
    height: theme.spacing(2),
    alignItems: 'flex-end',
    position: 'relative',
    width: 'fit-content',
  }),
  bar: css({
    width: theme.spacing(0.5),
    backgroundColor: theme.colors.text.primary,
    borderRadius: theme.shape.radius.default,
    cornerShape: 'squircle',
    display: 'inline-block',
    transformOrigin: 'bottom',
    height: theme.spacing(0.5),
    opacity: 0.7,
    [theme.transitions.handleMotion('no-preference', 'reduce')]: {
      animationName: getPulse(theme, 0.5, 1.5),
      animationDuration: '1.2s',
      animationIterationCount: 'infinite',
      animationTimingFunction: 'ease-in-out',
    },
    '&:nth-child(1)': {
      height: theme.spacing(0.8),
      [theme.transitions.handleMotion('no-preference', 'reduce')]: {
        animationDelay: '0.1s',
        animationName: getPulse(theme, 0.8, 1.8),
        animationDuration: '1.4s',
      },
    },
    '&:nth-child(2)': {
      height: theme.spacing(0.6),
      [theme.transitions.handleMotion('no-preference', 'reduce')]: {
        animationDelay: '0.3s',
        animationName: getPulse(theme, 0.6, 1.6),
        animationDuration: '1.1s',
      },
    },
    '&:nth-child(3)': {
      height: theme.spacing(0.7),
      [theme.transitions.handleMotion('no-preference', 'reduce')]: {
        animationDelay: '0.5s',
        animationName: getPulse(theme, 0.7, 1.7),
        animationDuration: '1.3s',
      },
    },
    '&:nth-child(4)': {
      height: theme.spacing(0.5),
      [theme.transitions.handleMotion('no-preference', 'reduce')]: {
        animationDelay: '0.7s',
        animationName: getPulse(theme, 0.5, 1.5),
        animationDuration: '1.2s',
      },
    },
    '&:nth-child(5)': {
      height: theme.spacing(0.9),
      [theme.transitions.handleMotion('no-preference', 'reduce')]: {
        animationDelay: '0.9s',
        animationName: getPulse(theme, 0.9, 1.9),
        animationDuration: '1.5s',
      },
    },
  }),
  particle: css({
    position: 'absolute',
    width: theme.spacing(0.2),
    height: theme.spacing(0.2),
    backgroundColor: theme.colors.text.primary,
    borderRadius: theme.shape.radius.circle,
    opacity: 0,
    '--tx': '0px',
    '--ty': '0px',
    [theme.transitions.handleMotion('no-preference', 'reduce')]: {
      animationName: getSparkle(),
      animationDuration: '1s',
      animationIterationCount: 'infinite',
      animationTimingFunction: 'ease-out',
    },
    '&:nth-child(6)': {
      top: '60%',
      left: '5%',
      '--tx': '8px',
      '--ty': '-20px',
      [theme.transitions.handleMotion('no-preference', 'reduce')]: {
        animationDelay: '0.2s',
      },
    },
    '&:nth-child(7)': {
      top: '50%',
      left: '25%',
      '--tx': '-6px',
      '--ty': '-25px',
      [theme.transitions.handleMotion('no-preference', 'reduce')]: {
        animationDelay: '0.4s',
      },
    },
    '&:nth-child(8)': {
      top: '55%',
      left: '45%',
      '--tx': '10px',
      '--ty': '-18px',
      [theme.transitions.handleMotion('no-preference', 'reduce')]: {
        animationDelay: '0.6s',
      },
    },
    '&:nth-child(9)': {
      top: '45%',
      left: '65%',
      '--tx': '-8px',
      '--ty': '-22px',
      [theme.transitions.handleMotion('no-preference', 'reduce')]: {
        animationDelay: '0.8s',
      },
    },
    '&:nth-child(10)': {
      top: '50%',
      left: '85%',
      '--tx': '6px',
      '--ty': '-28px',
      [theme.transitions.handleMotion('no-preference', 'reduce')]: {
        animationDelay: '1s',
      },
    },
  }),
  typewriterRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    minHeight: theme.spacing(2),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  cursor: css({
    [theme.transitions.handleMotion('no-preference', 'reduce')]: {
      animation: `${blink} 1s steps(1, end) infinite`,
    },
  }),
});
