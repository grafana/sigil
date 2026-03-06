import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, useStyles2 } from '@grafana/ui';
import { useSearchParams } from 'react-router-dom';
import type { ConversationDetail, GenerationDetail } from '../../conversation/types';
import { getGradientColorAtIndex } from './traceGradient';

const TRACE_ROW_STEP_PX = 14;
const TRACE_SPAN_HEIGHT_PX = 14;
const TRACE_LANE_PADDING_Y_PX = (TRACE_ROW_STEP_PX - TRACE_SPAN_HEIGHT_PX) / 2;
const TRACE_MIN_SPAN_WIDTH_PCT = 1;
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const NS_PER_US = BigInt(1_000);
const NS_PER_MS = BigInt(1_000_000);
const NS_PER_SECOND = BigInt(1_000_000_000);

export type TraceSpan = {
  traceID: string;
  spanID: string;
  name: string;
  serviceName: string;
  startNs: bigint;
  endNs: bigint;
  durationNs: bigint;
  row: number;
  selectionID: string;
};

export type TraceTimeline = {
  traceID: string;
  rowCount: number;
  spans: TraceSpan[];
  startNs: bigint;
  endNs: bigint;
};

type HoveredSpanAnchor = {
  topPx: number;
  left: string;
  maxWidthPx?: number;
};

type TooltipStyle = React.CSSProperties & {
  '--tooltip-border-color'?: string;
};

type ConversationTracesProps = {
  detail: ConversationDetail;
  traceLoadTotal: number;
  traceLoadRunning: boolean;
  traceLoadFailures: number;
  traceTimelines: TraceTimeline[];
};

function formatNsDuration(durationNs: bigint): string {
  if (durationNs < BIGINT_ZERO) {
    return 'unknown';
  }
  if (durationNs >= NS_PER_SECOND) {
    return `${(Number(durationNs) / Number(NS_PER_SECOND)).toFixed(3)} s`;
  }
  if (durationNs >= NS_PER_MS) {
    return `${(Number(durationNs) / Number(NS_PER_MS)).toFixed(2)} ms`;
  }
  if (durationNs >= NS_PER_US) {
    return `${(Number(durationNs) / Number(NS_PER_US)).toFixed(2)} us`;
  }
  return `${Number(durationNs).toFixed(0)} ns`;
}

function formatNsTimestamp(ns: bigint): string {
  if (ns <= BIGINT_ZERO) {
    return 'unknown';
  }
  return new Date(Number(ns / NS_PER_MS)).toISOString();
}

function formatNsShortTime(ns: bigint): string {
  if (ns <= BIGINT_ZERO) {
    return 'unknown';
  }
  return new Date(Number(ns / NS_PER_MS)).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function ratioToPercent(numerator: bigint, denominator: bigint): number {
  if (denominator <= BIGINT_ZERO) {
    return 0;
  }
  return (Number(numerator) / Number(denominator)) * 100;
}

function findGenerationForSpan(detail: ConversationDetail | null, span: Pick<TraceSpan, 'traceID' | 'spanID'> | null) {
  if (detail == null || span == null) {
    return null;
  }
  const byTraceAndSpan = detail.generations.find((generation) => {
    if (generation.trace_id !== span.traceID) {
      return false;
    }
    return generation.span_id === span.spanID;
  });
  if (byTraceAndSpan != null) {
    return byTraceAndSpan;
  }
  return detail.generations.find((generation) => generation.trace_id === span.traceID) ?? null;
}

function findGenerationForTrace(detail: ConversationDetail | null, traceID: string) {
  if (detail == null || traceID.length === 0) {
    return null;
  }
  return detail.generations.find((generation) => generation.trace_id === traceID) ?? null;
}

function getUsageValue(
  usage: GenerationDetail['usage'],
  key: 'input_tokens' | 'output_tokens' | 'total_tokens'
): string {
  const value = usage?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toLocaleString();
}

function getHoveredSpanAnchor(
  span: TraceSpan,
  timelineBounds: { min: bigint; range: bigint },
  laneWidthPx: number,
  timelineScalePct: number
): HoveredSpanAnchor {
  const rawLeftPct = ratioToPercent(span.startNs - timelineBounds.min, timelineBounds.range);
  const boundedWidthPct = Math.min(
    Math.max(ratioToPercent(span.durationNs, timelineBounds.range), TRACE_MIN_SPAN_WIDTH_PCT),
    100
  );
  const scaledLeftPct = Math.max(0, rawLeftPct * timelineScalePct);
  const scaledWidthPct = Math.max(0, boundedWidthPct * timelineScalePct);
  const spanCenterPct = scaledLeftPct + scaledWidthPct / 2;
  const edgePaddingPx = 8;
  const topPx = span.row * TRACE_ROW_STEP_PX + TRACE_SPAN_HEIGHT_PX + 8;

  if (laneWidthPx <= 0) {
    return {
      topPx,
      left: `${spanCenterPct}%`,
    };
  }

  const tooltipMaxWidthPx = Math.min(560, Math.max(0, laneWidthPx - edgePaddingPx * 2));
  const halfTooltipWidthPx = tooltipMaxWidthPx / 2;
  const spanCenterPx = (spanCenterPct / 100) * laneWidthPx;
  const clampedCenterPx = Math.min(
    Math.max(spanCenterPx, halfTooltipWidthPx + edgePaddingPx),
    laneWidthPx - halfTooltipWidthPx - edgePaddingPx
  );

  return {
    topPx,
    left: `${clampedCenterPx}px`,
    maxWidthPx: tooltipMaxWidthPx,
  };
}

function getHoveredTraceAnchor(
  leftPct: number,
  widthPct: number,
  laneWidthPx: number,
  topPx: number
): HoveredSpanAnchor {
  const traceCenterPct = leftPct + widthPct / 2;
  const edgePaddingPx = 8;
  if (laneWidthPx <= 0) {
    return {
      topPx,
      left: `${traceCenterPct}%`,
    };
  }
  const tooltipMaxWidthPx = Math.min(560, Math.max(0, laneWidthPx - edgePaddingPx * 2));
  const halfTooltipWidthPx = tooltipMaxWidthPx / 2;
  const traceCenterPx = (traceCenterPct / 100) * laneWidthPx;
  const clampedCenterPx = Math.min(
    Math.max(traceCenterPx, halfTooltipWidthPx + edgePaddingPx),
    laneWidthPx - halfTooltipWidthPx - edgePaddingPx
  );

  return {
    topPx,
    left: `${clampedCenterPx}px`,
    maxWidthPx: tooltipMaxWidthPx,
  };
}

function getSpanAtLaneY(spans: TraceSpan[], laneY: number): TraceSpan | null {
  if (spans.length === 0) {
    return null;
  }
  const row = Math.floor(Math.max(0, laneY) / TRACE_ROW_STEP_PX);
  if (row < 0 || row >= spans.length) {
    return null;
  }
  return spans[row] ?? null;
}

const getStyles = (theme: GrafanaTheme2) => ({
  traceTimelineContainer: css({
    label: 'conversationTraces-traceTimelineContainer',
    display: 'grid',
    gap: 0,
  }),
  traceTimelineEmpty: css({
    label: 'conversationTraces-traceTimelineEmpty',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  traceRow: css({
    label: 'conversationTraces-traceRow',
    display: 'block',
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
  }),
  traceLane: css({
    label: 'conversationTraces-traceLane',
    position: 'relative' as const,
    overflow: 'visible' as const,
    cursor: 'pointer',
  }),
  traceTimeRange: css({
    label: 'conversationTraces-traceTimeRange',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: theme.spacing(0.5, 0),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  traceTimeLabel: css({
    label: 'conversationTraces-traceTimeLabel',
    whiteSpace: 'nowrap' as const,
  }),
  traceZoomHeader: css({
    label: 'conversationTraces-traceZoomHeader',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: theme.spacing(0.5),
    gap: theme.spacing(1),
  }),
  traceZoomLabel: css({
    label: 'conversationTraces-traceZoomLabel',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  traceZoomBackButton: css({
    label: 'conversationTraces-traceZoomBackButton',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    padding: theme.spacing(0.5, 1),
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  traceZoomBackArrow: css({
    label: 'conversationTraces-traceZoomBackArrow',
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  hoveredSpanTooltip: css({
    label: 'conversationTraces-hoveredSpanTooltip',
    position: 'absolute' as const,
    zIndex: 1,
    transform: 'translateX(-50%)',
    width: 'max-content',
    maxWidth: `min(560px, calc(100% - ${theme.spacing(2)}))`,
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    border: `2px solid var(--tooltip-border-color, ${theme.colors.border.medium})`,
    background: theme.colors.background.secondary,
    boxShadow: theme.shadows.z2,
    display: 'grid',
    gap: theme.spacing(0.25),
    fontSize: theme.typography.bodySmall.fontSize,
    pointerEvents: 'none' as const,
    '&::before': {
      content: '""',
      position: 'absolute' as const,
      top: -8,
      left: '50%',
      transform: 'translateX(-50%)',
      borderLeft: '7px solid transparent',
      borderRight: '7px solid transparent',
      borderBottom: `8px solid var(--tooltip-border-color, ${theme.colors.border.medium})`,
    },
    '&::after': {
      content: '""',
      position: 'absolute' as const,
      top: -7,
      left: '50%',
      transform: 'translateX(-50%)',
      borderLeft: '6px solid transparent',
      borderRight: '6px solid transparent',
      borderBottom: `7px solid ${theme.colors.background.secondary}`,
    },
  }),
  hoveredSpanTitle: css({
    label: 'conversationTraces-hoveredSpanTitle',
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  hoveredSpanMeta: css({
    label: 'conversationTraces-hoveredSpanMeta',
    color: theme.colors.text.secondary,
  }),
  hoveredSpanRow: css({
    label: 'conversationTraces-hoveredSpanRow',
    display: 'grid',
    gridTemplateColumns: '120px minmax(0, 1fr)',
    gap: theme.spacing(0.5),
    alignItems: 'baseline',
    wordBreak: 'break-word' as const,
  }),
  hoveredSpanLabel: css({
    label: 'conversationTraces-hoveredSpanLabel',
    color: theme.colors.text.secondary,
  }),
  hoveredSpanValue: css({
    label: 'conversationTraces-hoveredSpanValue',
    color: theme.colors.text.primary,
  }),
  spanBar: css({
    label: 'conversationTraces-spanBar',
    position: 'absolute' as const,
    height: `${TRACE_SPAN_HEIGHT_PX}px`,
    borderRadius: 2,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.text.disabled,
    color: theme.colors.primary.contrastText,
    fontSize: theme.typography.bodySmall.fontSize,
    padding: 0,
    cursor: 'pointer',
    opacity: 0.7,
    transition: 'opacity 0.12s ease, box-shadow 0.12s ease',
  }),
  spanBarRowHovered: css({
    label: 'conversationTraces-spanBarRowHovered',
    opacity: 0.86,
  }),
  spanBarSelected: css({
    label: 'conversationTraces-spanBarSelected',
    opacity: 1,
    boxShadow: `0 0 0 2px ${theme.colors.primary.transparent}`,
  }),
  spanRowBackground: css({
    label: 'conversationTraces-spanRowBackground',
    position: 'absolute' as const,
    left: 0,
    width: '100%',
    borderRadius: 2,
    opacity: 0,
    pointerEvents: 'none' as const,
    transition: 'opacity 0.12s ease',
  }),
  spanRowBackgroundHovered: css({
    label: 'conversationTraces-spanRowBackgroundHovered',
    opacity: 0.12,
  }),
  selectedSpanCard: css({
    label: 'conversationTraces-selectedSpanCard',
    marginTop: theme.spacing(1),
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    display: 'grid',
    gap: theme.spacing(0.5),
  }),
  selectedSpanSectionTitle: css({
    label: 'conversationTraces-selectedSpanSectionTitle',
    marginTop: theme.spacing(0.25),
    marginBottom: theme.spacing(0.5),
  }),
  selectedSpanGrid: css({
    label: 'conversationTraces-selectedSpanGrid',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: theme.spacing(1),
  }),
  selectedSpanGroup: css({
    label: 'conversationTraces-selectedSpanGroup',
    display: 'grid',
    gap: theme.spacing(0.375),
    padding: theme.spacing(0.75),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  selectedSpanRow: css({
    label: 'conversationTraces-selectedSpanRow',
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 150px) minmax(0, 1fr)',
    gap: theme.spacing(0.75),
    alignItems: 'baseline',
    wordBreak: 'break-word' as const,
  }),
  selectedSpanLabel: css({
    label: 'conversationTraces-selectedSpanLabel',
    color: theme.colors.text.secondary,
  }),
  selectedSpanValue: css({
    label: 'conversationTraces-selectedSpanValue',
    color: theme.colors.text.primary,
  }),
});

export default function ConversationTraces({
  detail,
  traceLoadTotal,
  traceLoadRunning,
  traceLoadFailures,
  traceTimelines,
}: ConversationTracesProps) {
  const styles = useStyles2(getStyles);
  const [hoveredSpanSelectionID, setHoveredSpanSelectionID] = useState<string>('');
  const [hoveredSpanAnchor, setHoveredSpanAnchor] = useState<HoveredSpanAnchor | null>(null);
  const [hoveredTraceID, setHoveredTraceID] = useState<string>('');
  const [hoveredTraceAnchor, setHoveredTraceAnchor] = useState<HoveredSpanAnchor | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedSpanID = searchParams.get('span') ?? '';
  const expandedTraceID = searchParams.get('trace') ?? '';
  const expandedTimeline = useMemo(() => {
    if (expandedTraceID.length === 0) {
      return null;
    }
    return traceTimelines.find((timeline) => timeline.traceID === expandedTraceID) ?? null;
  }, [expandedTraceID, traceTimelines]);
  const isExpandedTraceView = expandedTimeline != null;
  const displayedTimelines = useMemo(() => {
    if (expandedTimeline == null) {
      return traceTimelines;
    }
    return [expandedTimeline];
  }, [expandedTimeline, traceTimelines]);
  const timelineBounds = useMemo(() => {
    let min: bigint | null = null;
    let max: bigint | null = null;
    for (const timeline of displayedTimelines) {
      if (min == null || timeline.startNs < min) {
        min = timeline.startNs;
      }
      if (max == null || timeline.endNs > max) {
        max = timeline.endNs;
      }
    }
    if (min == null || max == null || max <= min) {
      return { min: BIGINT_ZERO, range: BIGINT_ONE };
    }
    return { min, range: max - min };
  }, [displayedTimelines]);
  const timelineScalePct = useMemo(() => {
    let maxRightPct = 100;
    for (const timeline of displayedTimelines) {
      for (const span of timeline.spans) {
        const rawLeftPct = ratioToPercent(span.startNs - timelineBounds.min, timelineBounds.range);
        const boundedWidthPct = Math.min(
          Math.max(ratioToPercent(span.durationNs, timelineBounds.range), TRACE_MIN_SPAN_WIDTH_PCT),
          100
        );
        maxRightPct = Math.max(maxRightPct, rawLeftPct + boundedWidthPct);
      }
    }
    if (maxRightPct <= 100) {
      return 1;
    }
    return 100 / maxRightPct;
  }, [displayedTimelines, timelineBounds.min, timelineBounds.range]);
  const selectedSpan = useMemo(() => {
    for (const timeline of traceTimelines) {
      for (const span of timeline.spans) {
        if (span.selectionID === selectedSpanID) {
          return span;
        }
      }
    }
    return null;
  }, [selectedSpanID, traceTimelines]);
  const visibleSelectedSpan = useMemo(() => {
    if (selectedSpan == null) {
      return null;
    }
    if (!isExpandedTraceView) {
      return null;
    }
    return selectedSpan.traceID === expandedTimeline.traceID ? selectedSpan : null;
  }, [expandedTimeline, isExpandedTraceView, selectedSpan]);
  const hoveredSpan = useMemo(() => {
    for (const timeline of displayedTimelines) {
      for (const span of timeline.spans) {
        if (span.selectionID === hoveredSpanSelectionID) {
          return span;
        }
      }
    }
    return null;
  }, [displayedTimelines, hoveredSpanSelectionID]);
  const selectedGeneration = useMemo(() => {
    return findGenerationForSpan(detail, visibleSelectedSpan);
  }, [detail, visibleSelectedSpan]);
  const hoveredGeneration = useMemo(() => {
    return findGenerationForSpan(detail, hoveredSpan);
  }, [detail, hoveredSpan]);
  const hoveredTraceGeneration = useMemo(() => {
    return findGenerationForTrace(detail, hoveredTraceID);
  }, [detail, hoveredTraceID]);
  const selectedGenerationUsageExtras = useMemo(() => {
    if (selectedGeneration?.usage == null) {
      return [];
    }
    return Object.entries(selectedGeneration.usage)
      .filter(
        ([key, value]) => !['input_tokens', 'output_tokens', 'total_tokens'].includes(key) && typeof value === 'number'
      )
      .sort(([a], [b]) => a.localeCompare(b));
  }, [selectedGeneration]);
  const setSelectedSpanParam = (selectionID: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (selectedSpanID === selectionID) {
      nextParams.delete('span');
    } else {
      nextParams.set('span', selectionID);
    }
    setSearchParams(nextParams);
  };
  const setExpandedTraceParam = (traceID: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (traceID.length === 0) {
      nextParams.delete('trace');
      nextParams.delete('span');
    } else {
      nextParams.set('trace', traceID);
      nextParams.delete('span');
    }
    setHoveredSpanSelectionID('');
    setHoveredSpanAnchor(null);
    setHoveredTraceID('');
    setHoveredTraceAnchor(null);
    setSearchParams(nextParams);
  };

  if (traceLoadTotal === 0) {
    return null;
  }

  return (
    <div className={styles.traceTimelineContainer}>
      {traceTimelines.length === 0 ? (
        <div className={styles.traceTimelineEmpty}>
          {traceLoadRunning ? 'Loading trace spans...' : 'No spans found in retrieved traces.'}
        </div>
      ) : (
        <>
          {isExpandedTraceView && (
            <div className={styles.traceZoomHeader}>
              <button
                type="button"
                className={styles.traceZoomBackButton}
                onClick={() => setExpandedTraceParam('')}
                aria-label="close expanded trace"
              >
                <span className={styles.traceZoomBackArrow}>⟵</span>
                <span>Back to traces</span>
              </button>
              <span className={styles.traceZoomLabel}>Trace: {expandedTimeline.traceID}</span>
            </div>
          )}
          <div className={styles.traceTimeRange}>
            <span className={styles.traceTimeLabel} title={formatNsTimestamp(timelineBounds.min)}>
              {formatNsShortTime(timelineBounds.min)}
            </span>
            <span
              className={styles.traceTimeLabel}
              title={formatNsTimestamp(timelineBounds.min + timelineBounds.range)}
            >
              {formatNsShortTime(timelineBounds.min + timelineBounds.range)}
            </span>
          </div>
          {displayedTimelines.map((timeline, timelineIndex) => {
            const timelineColor = getGradientColorAtIndex(displayedTimelines.length, timelineIndex, 0.82);
            if (!isExpandedTraceView) {
              const traceDurationNs =
                timeline.endNs > timeline.startNs ? timeline.endNs - timeline.startNs : BIGINT_ONE;
              const rawLeftPct = ratioToPercent(timeline.startNs - timelineBounds.min, timelineBounds.range);
              const boundedWidthPct = Math.min(
                Math.max(ratioToPercent(traceDurationNs, timelineBounds.range), TRACE_MIN_SPAN_WIDTH_PCT),
                100
              );
              const scaledLeftPct = Math.max(0, rawLeftPct * timelineScalePct);
              const scaledWidthPct = Math.max(0, boundedWidthPct * timelineScalePct);
              return (
                <div
                  key={timeline.traceID}
                  className={styles.traceRow}
                  data-testid={`trace-row-${timeline.traceID}`}
                  onMouseMove={(event) => {
                    const laneElement = event.currentTarget.querySelector(
                      `.${styles.traceLane}`
                    ) as HTMLDivElement | null;
                    if (laneElement == null) {
                      return;
                    }
                    setHoveredTraceID(timeline.traceID);
                    setHoveredTraceAnchor(
                      getHoveredTraceAnchor(
                        scaledLeftPct,
                        scaledWidthPct,
                        laneElement.clientWidth,
                        TRACE_SPAN_HEIGHT_PX + 8
                      )
                    );
                  }}
                  onMouseLeave={() => {
                    setHoveredTraceID('');
                    setHoveredTraceAnchor(null);
                  }}
                  onClick={() => setExpandedTraceParam(timeline.traceID)}
                >
                  <div
                    className={styles.traceLane}
                    style={{
                      height: `${TRACE_SPAN_HEIGHT_PX + TRACE_LANE_PADDING_Y_PX * 2}px`,
                    }}
                  >
                    <div
                      className={`${styles.spanRowBackground} ${
                        hoveredTraceID === timeline.traceID ? styles.spanRowBackgroundHovered : ''
                      }`}
                      style={{
                        top: '0px',
                        height: `${TRACE_ROW_STEP_PX}px`,
                        background: timelineColor,
                      }}
                    />
                    <button
                      type="button"
                      className={`${styles.spanBar} ${hoveredTraceID === timeline.traceID ? styles.spanBarRowHovered : ''}`}
                      style={{
                        top: '0px',
                        left: `${scaledLeftPct}%`,
                        width: `${scaledWidthPct}%`,
                        background: hoveredTraceID === timeline.traceID ? timelineColor : undefined,
                        borderColor: hoveredTraceID === timeline.traceID ? timelineColor : undefined,
                      }}
                      aria-label={`expand trace ${timeline.traceID}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedTraceParam(timeline.traceID);
                      }}
                    >
                      {null}
                    </button>
                    {hoveredTraceID === timeline.traceID && hoveredTraceAnchor != null && (
                      <div
                        className={styles.hoveredSpanTooltip}
                        data-testid="hovered-trace-tooltip"
                        style={
                          {
                            '--tooltip-border-color': timelineColor,
                            top: `${hoveredTraceAnchor.topPx}px`,
                            left: hoveredTraceAnchor.left,
                            maxWidth:
                              hoveredTraceAnchor.maxWidthPx != null ? `${hoveredTraceAnchor.maxWidthPx}px` : undefined,
                          } as TooltipStyle
                        }
                      >
                        <div className={styles.hoveredSpanTitle}>Trace {timeline.traceID}</div>
                        <div className={styles.hoveredSpanRow}>
                          <span className={styles.hoveredSpanLabel}>Time range</span>
                          <span className={styles.hoveredSpanValue}>
                            {formatNsTimestamp(timeline.startNs)} - {formatNsTimestamp(timeline.endNs)}
                          </span>
                        </div>
                        <div className={styles.hoveredSpanRow}>
                          <span className={styles.hoveredSpanLabel}>Duration</span>
                          <span className={styles.hoveredSpanValue}>
                            {formatNsDuration(
                              timeline.endNs > timeline.startNs ? timeline.endNs - timeline.startNs : BIGINT_ONE
                            )}
                          </span>
                        </div>
                        <div className={styles.hoveredSpanRow}>
                          <span className={styles.hoveredSpanLabel}>Spans</span>
                          <span className={styles.hoveredSpanValue}>{timeline.spans.length}</span>
                        </div>
                        {hoveredTraceGeneration != null && (
                          <>
                            <div className={styles.hoveredSpanRow}>
                              <span className={styles.hoveredSpanLabel}>Generation ID</span>
                              <span className={styles.hoveredSpanValue}>{hoveredTraceGeneration.generation_id}</span>
                            </div>
                            <div className={styles.hoveredSpanRow}>
                              <span className={styles.hoveredSpanLabel}>Model</span>
                              <span className={styles.hoveredSpanValue}>
                                {hoveredTraceGeneration.model?.provider ?? 'unknown-provider'} /{' '}
                                {hoveredTraceGeneration.model?.name ?? 'unknown-model'}
                              </span>
                            </div>
                            <div className={styles.hoveredSpanRow}>
                              <span className={styles.hoveredSpanLabel}>Mode</span>
                              <span className={styles.hoveredSpanValue}>{hoveredTraceGeneration.mode ?? 'n/a'}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            const expandedSpans = timeline.spans.map((span, index) => ({
              ...span,
              row: index,
            }));
            return (
              <div
                key={timeline.traceID}
                className={styles.traceRow}
                data-testid={`trace-row-${timeline.traceID}`}
                onMouseMove={(event) => {
                  const laneElement = event.currentTarget.querySelector(
                    `.${styles.traceLane}`
                  ) as HTMLDivElement | null;
                  if (laneElement == null) {
                    return;
                  }
                  const laneRect = laneElement.getBoundingClientRect();
                  const laneY = event.clientY - laneRect.top;
                  const hoveredRowSpan = getSpanAtLaneY(expandedSpans, laneY);
                  if (hoveredRowSpan == null) {
                    setHoveredSpanSelectionID('');
                    setHoveredSpanAnchor(null);
                    return;
                  }
                  setHoveredSpanSelectionID(hoveredRowSpan.selectionID);
                  setHoveredSpanAnchor(
                    getHoveredSpanAnchor(hoveredRowSpan, timelineBounds, laneElement.clientWidth, timelineScalePct)
                  );
                }}
                onMouseLeave={() => {
                  setHoveredSpanSelectionID('');
                  setHoveredSpanAnchor(null);
                }}
                onClick={(event) => {
                  const laneElement = event.currentTarget.querySelector(
                    `.${styles.traceLane}`
                  ) as HTMLDivElement | null;
                  if (laneElement == null) {
                    return;
                  }
                  const laneRect = laneElement.getBoundingClientRect();
                  const laneY = event.clientY - laneRect.top;
                  const selectedRowSpan = getSpanAtLaneY(expandedSpans, laneY);
                  if (selectedRowSpan == null) {
                    return;
                  }
                  setSelectedSpanParam(selectedRowSpan.selectionID);
                }}
              >
                <div
                  className={styles.traceLane}
                  style={{
                    height: `${expandedSpans.length * TRACE_ROW_STEP_PX + TRACE_LANE_PADDING_Y_PX * 2}px`,
                  }}
                >
                  {expandedSpans.map((span) => {
                    const spanColor = getGradientColorAtIndex(expandedSpans.length, span.row, 0.82);
                    const rawLeftPct = ratioToPercent(span.startNs - timelineBounds.min, timelineBounds.range);
                    const boundedWidthPct = Math.min(
                      Math.max(ratioToPercent(span.durationNs, timelineBounds.range), TRACE_MIN_SPAN_WIDTH_PCT),
                      100
                    );
                    const scaledLeftPct = Math.max(0, rawLeftPct * timelineScalePct);
                    const scaledWidthPct = Math.max(0, boundedWidthPct * timelineScalePct);
                    const isSelected = selectedSpanID === span.selectionID;
                    const isRowHovered = hoveredSpanSelectionID === span.selectionID;
                    return (
                      <React.Fragment key={`${span.selectionID}:${span.row}`}>
                        <div
                          className={`${styles.spanRowBackground} ${isRowHovered ? styles.spanRowBackgroundHovered : ''}`}
                          style={{
                            top: `${span.row * TRACE_ROW_STEP_PX}px`,
                            height: `${TRACE_ROW_STEP_PX}px`,
                            background: spanColor,
                          }}
                        />
                        <button
                          type="button"
                          className={`${styles.spanBar} ${isRowHovered && !isSelected ? styles.spanBarRowHovered : ''} ${
                            isSelected ? styles.spanBarSelected : ''
                          }`}
                          style={{
                            top: `${span.row * TRACE_ROW_STEP_PX}px`,
                            left: `${scaledLeftPct}%`,
                            width: `${scaledWidthPct}%`,
                            background: isRowHovered || isSelected ? spanColor : undefined,
                            borderColor: isRowHovered || isSelected ? spanColor : undefined,
                          }}
                          aria-label={`select span ${span.name}`}
                          aria-pressed={isSelected}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedSpanParam(span.selectionID);
                          }}
                          onMouseEnter={(event) => {
                            const laneWidthPx = event.currentTarget.parentElement?.clientWidth ?? 0;
                            setHoveredSpanSelectionID(span.selectionID);
                            setHoveredSpanAnchor(
                              getHoveredSpanAnchor(span, timelineBounds, laneWidthPx, timelineScalePct)
                            );
                          }}
                          onMouseLeave={() => {
                            setHoveredSpanSelectionID('');
                            setHoveredSpanAnchor(null);
                          }}
                        >
                          {null}
                        </button>
                        {hoveredSpan?.selectionID === span.selectionID && hoveredSpanAnchor != null && (
                          <div
                            className={styles.hoveredSpanTooltip}
                            data-testid="hovered-span-tooltip"
                            style={
                              {
                                '--tooltip-border-color': spanColor,
                                top: `${hoveredSpanAnchor.topPx}px`,
                                left: hoveredSpanAnchor.left,
                                maxWidth:
                                  hoveredSpanAnchor.maxWidthPx != null
                                    ? `${hoveredSpanAnchor.maxWidthPx}px`
                                    : undefined,
                              } as TooltipStyle
                            }
                          >
                            <div className={styles.hoveredSpanTitle}>{hoveredSpan.name}</div>
                            <div className={styles.hoveredSpanMeta}>{hoveredSpan.serviceName}</div>
                            <div className={styles.hoveredSpanRow}>
                              <span className={styles.hoveredSpanLabel}>Time range</span>
                              <span className={styles.hoveredSpanValue}>
                                {formatNsTimestamp(hoveredSpan.startNs)} - {formatNsTimestamp(hoveredSpan.endNs)}
                              </span>
                            </div>
                            <div className={styles.hoveredSpanRow}>
                              <span className={styles.hoveredSpanLabel}>Duration</span>
                              <span className={styles.hoveredSpanValue}>
                                {formatNsDuration(hoveredSpan.durationNs)}
                              </span>
                            </div>
                            <div className={styles.hoveredSpanRow}>
                              <span className={styles.hoveredSpanLabel}>Trace ID</span>
                              <span className={styles.hoveredSpanValue}>{hoveredSpan.traceID}</span>
                            </div>
                            <div className={styles.hoveredSpanRow}>
                              <span className={styles.hoveredSpanLabel}>Span ID</span>
                              <span className={styles.hoveredSpanValue}>{hoveredSpan.spanID || 'unknown-span'}</span>
                            </div>
                            {hoveredGeneration != null && (
                              <>
                                <div className={styles.hoveredSpanRow}>
                                  <span className={styles.hoveredSpanLabel}>Generation ID</span>
                                  <span className={styles.hoveredSpanValue}>{hoveredGeneration.generation_id}</span>
                                </div>
                                <div className={styles.hoveredSpanRow}>
                                  <span className={styles.hoveredSpanLabel}>Model</span>
                                  <span className={styles.hoveredSpanValue}>
                                    {hoveredGeneration.model?.provider ?? 'unknown-provider'} /{' '}
                                    {hoveredGeneration.model?.name ?? 'unknown-model'}
                                  </span>
                                </div>
                                <div className={styles.hoveredSpanRow}>
                                  <span className={styles.hoveredSpanLabel}>Mode</span>
                                  <span className={styles.hoveredSpanValue}>{hoveredGeneration.mode ?? 'n/a'}</span>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className={styles.traceTimeRange}>
            <span className={styles.traceTimeLabel} title={formatNsTimestamp(timelineBounds.min)}>
              {formatNsShortTime(timelineBounds.min)}
            </span>
            <span
              className={styles.traceTimeLabel}
              title={formatNsTimestamp(timelineBounds.min + timelineBounds.range)}
            >
              {formatNsShortTime(timelineBounds.min + timelineBounds.range)}
            </span>
          </div>
        </>
      )}
      {visibleSelectedSpan != null && (
        <div className={styles.selectedSpanCard}>
          <strong className={styles.selectedSpanSectionTitle}>Selected span details</strong>
          <div className={styles.selectedSpanGrid}>
            <div className={styles.selectedSpanGroup}>
              <div className={styles.selectedSpanRow}>
                <span className={styles.selectedSpanLabel}>Name</span>
                <span className={styles.selectedSpanValue}>{visibleSelectedSpan.name}</span>
              </div>
              <div className={styles.selectedSpanRow}>
                <span className={styles.selectedSpanLabel}>Service</span>
                <span className={styles.selectedSpanValue}>{visibleSelectedSpan.serviceName}</span>
              </div>
              <div className={styles.selectedSpanRow}>
                <span className={styles.selectedSpanLabel}>Trace ID</span>
                <span className={styles.selectedSpanValue}>{visibleSelectedSpan.traceID}</span>
              </div>
              <div className={styles.selectedSpanRow}>
                <span className={styles.selectedSpanLabel}>Span ID</span>
                <span className={styles.selectedSpanValue}>{visibleSelectedSpan.spanID || 'unknown-span'}</span>
              </div>
              <div className={styles.selectedSpanRow}>
                <span className={styles.selectedSpanLabel}>Start</span>
                <span className={styles.selectedSpanValue}>{formatNsTimestamp(visibleSelectedSpan.startNs)}</span>
              </div>
              <div className={styles.selectedSpanRow}>
                <span className={styles.selectedSpanLabel}>End</span>
                <span className={styles.selectedSpanValue}>{formatNsTimestamp(visibleSelectedSpan.endNs)}</span>
              </div>
              <div className={styles.selectedSpanRow}>
                <span className={styles.selectedSpanLabel}>Duration</span>
                <span className={styles.selectedSpanValue}>{formatNsDuration(visibleSelectedSpan.durationNs)}</span>
              </div>
            </div>
            <div className={styles.selectedSpanGroup}>
              <strong>Associated generation</strong>
              {selectedGeneration == null ? (
                <div className={styles.selectedSpanValue}>No generation found for this trace/span.</div>
              ) : (
                <>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Generation ID</span>
                    <span className={styles.selectedSpanValue}>{selectedGeneration.generation_id}</span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Mode</span>
                    <span className={styles.selectedSpanValue}>{selectedGeneration.mode ?? 'n/a'}</span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Model</span>
                    <span className={styles.selectedSpanValue}>
                      {selectedGeneration.model?.provider ?? 'unknown-provider'} /{' '}
                      {selectedGeneration.model?.name ?? 'unknown-model'}
                    </span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Agent</span>
                    <span className={styles.selectedSpanValue}>
                      {selectedGeneration.agent_name ?? 'n/a'}
                      {selectedGeneration.agent_version ? ` (${selectedGeneration.agent_version})` : ''}
                    </span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Stop reason</span>
                    <span className={styles.selectedSpanValue}>{selectedGeneration.stop_reason ?? 'n/a'}</span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Created at</span>
                    <span className={styles.selectedSpanValue}>{selectedGeneration.created_at ?? 'n/a'}</span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Input tokens</span>
                    <span className={styles.selectedSpanValue}>
                      {getUsageValue(selectedGeneration.usage, 'input_tokens')}
                    </span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Output tokens</span>
                    <span className={styles.selectedSpanValue}>
                      {getUsageValue(selectedGeneration.usage, 'output_tokens')}
                    </span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Total tokens</span>
                    <span className={styles.selectedSpanValue}>
                      {getUsageValue(selectedGeneration.usage, 'total_tokens')}
                    </span>
                  </div>
                  {selectedGenerationUsageExtras.map(([key, value]) => (
                    <div key={key} className={styles.selectedSpanRow}>
                      <span className={styles.selectedSpanLabel}>{key}</span>
                      <span className={styles.selectedSpanValue}>
                        {typeof value === 'number' ? value.toLocaleString() : 'n/a'}
                      </span>
                    </div>
                  ))}
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Inputs</span>
                    <span className={styles.selectedSpanValue}>
                      {Array.isArray(selectedGeneration.input) ? selectedGeneration.input.length : 0}
                    </span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Outputs</span>
                    <span className={styles.selectedSpanValue}>
                      {Array.isArray(selectedGeneration.output) ? selectedGeneration.output.length : 0}
                    </span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Tools</span>
                    <span className={styles.selectedSpanValue}>
                      {Array.isArray(selectedGeneration.tools) ? selectedGeneration.tools.length : 0}
                    </span>
                  </div>
                  <div className={styles.selectedSpanRow}>
                    <span className={styles.selectedSpanLabel}>Error</span>
                    <span className={styles.selectedSpanValue}>{selectedGeneration.error?.message ?? 'none'}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {traceLoadFailures > 0 && (
        <Alert severity="warning" title="Some traces failed to load">
          {traceLoadFailures} of {traceLoadTotal} trace requests failed.
        </Alert>
      )}
    </div>
  );
}
