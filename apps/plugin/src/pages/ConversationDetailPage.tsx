import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Alert, Spinner, useStyles2 } from '@grafana/ui';
import { lastValueFrom } from 'rxjs';
import { useParams, useSearchParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationDetail, GenerationDetail } from '../conversation/types';

export type ConversationDetailPageProps = {
  dataSource?: ConversationsDataSource;
};

const TRACE_ROW_STEP_PX = 14;
const TRACE_SPAN_HEIGHT_PX = 14;
const TRACE_LANE_PADDING_Y_PX = (TRACE_ROW_STEP_PX - TRACE_SPAN_HEIGHT_PX) / 2;
const TRACE_MIN_SPAN_WIDTH_PCT = 1;
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const NS_PER_US = BigInt(1_000);
const NS_PER_MS = BigInt(1_000_000);
const NS_PER_SECOND = BigInt(1_000_000_000);

type TraceSpan = {
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

type TraceTimeline = {
  traceID: string;
  rowCount: number;
  spans: TraceSpan[];
  startNs: bigint;
  endNs: bigint;
  generationStartNs: bigint | null;
  generationCompletedNs: bigint | null;
};

type HoveredSpanAnchor = {
  topPx: number;
  left: string;
  maxWidthPx?: number;
};

type AttrValue = {
  stringValue?: string;
};

type AttrKV = {
  key?: string;
  value?: AttrValue;
};

type TempoSpan = {
  spanId?: string;
  span_id?: string;
  name?: string;
  completed_at?: string | number;
  completedAt?: string | number;
  startTimeUnixNano?: string | number;
  start_time_unix_nano?: string | number;
  endTimeUnixNano?: string | number;
  end_time_unix_nano?: string | number;
};

type TempoScopeSpan = {
  spans?: TempoSpan[];
};

type TempoResource = {
  attributes?: AttrKV[];
};

type TempoResourceSpan = {
  resource?: TempoResource;
  scopeSpans?: TempoScopeSpan[];
  scope_spans?: TempoScopeSpan[];
};

type TempoTrace = {
  resourceSpans?: TempoResourceSpan[];
  resource_spans?: TempoResourceSpan[];
};

function parseNs(raw: unknown): bigint | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) {
      return null;
    }
    return BigInt(Math.trunc(raw));
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  try {
    const parsed = BigInt(raw);
    return parsed > BIGINT_ZERO ? parsed : null;
  } catch {
    return null;
  }
}

function parseTimestampToNs(raw: unknown): bigint | null {
  if (typeof raw === 'number') {
    return parseNs(raw);
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  const numeric = /^\d+$/.test(raw) ? parseNs(raw) : null;
  if (numeric != null) {
    return numeric;
  }
  const parsedMs = Date.parse(raw);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }
  return BigInt(Math.trunc(parsedMs)) * NS_PER_MS;
}

function findServiceName(resourceSpan: TempoResourceSpan): string {
  const attributes = resourceSpan.resource?.attributes;
  if (!Array.isArray(attributes)) {
    return 'unknown-service';
  }
  const serviceAttr = attributes.find((attr) => attr?.key === 'service.name');
  return serviceAttr?.value?.stringValue ?? 'unknown-service';
}

function getTraceCandidates(payload: unknown): TempoTrace[] {
  if (payload == null || typeof payload !== 'object') {
    return [];
  }
  const maybeTrace = payload as { trace?: unknown; traces?: unknown[] };
  const candidates: unknown[] = [payload];
  if (maybeTrace.trace != null) {
    candidates.push(maybeTrace.trace);
  }
  if (Array.isArray(maybeTrace.traces)) {
    candidates.push(...maybeTrace.traces);
  }
  return candidates.filter((candidate): candidate is TempoTrace => candidate != null && typeof candidate === 'object');
}

function buildTraceSpans(traceID: string, payload: unknown): Array<Omit<TraceSpan, 'row'>> {
  const spans: Array<Omit<TraceSpan, 'row'>> = [];
  const traceCandidates = getTraceCandidates(payload);

  for (const trace of traceCandidates) {
    const resourceSpans = trace.resourceSpans ?? trace.resource_spans;
    if (!Array.isArray(resourceSpans)) {
      continue;
    }

    for (const resourceSpan of resourceSpans) {
      const serviceName = findServiceName(resourceSpan);
      const scopeSpans = resourceSpan.scopeSpans ?? resourceSpan.scope_spans;
      if (!Array.isArray(scopeSpans)) {
        continue;
      }

      for (const scopeSpan of scopeSpans) {
        if (!Array.isArray(scopeSpan.spans)) {
          continue;
        }
        for (const span of scopeSpan.spans) {
          const startNs = parseNs(span.startTimeUnixNano ?? span.start_time_unix_nano);
          const completedAtNs = parseTimestampToNs(span.completed_at ?? span.completedAt);
          const endNs = completedAtNs ?? parseNs(span.endTimeUnixNano ?? span.end_time_unix_nano);
          if (startNs == null) {
            continue;
          }
          const safeEnd = endNs != null && endNs >= startNs ? endNs : startNs;
          const spanID = span.spanId ?? span.span_id ?? '';
          const name = span.name?.trim() ?? '';
          spans.push({
            traceID,
            spanID,
            name: name.length > 0 ? name : '(unnamed span)',
            serviceName,
            startNs,
            endNs: safeEnd,
            durationNs: safeEnd > startNs ? safeEnd - startNs : BIGINT_ONE,
            selectionID: `${traceID}:${spanID.length > 0 ? spanID : `${startNs}`}`,
          });
        }
      }
    }
  }

  return spans;
}

function layoutSpans(rawSpans: Array<Omit<TraceSpan, 'row'>>): { rowCount: number; spans: TraceSpan[] } {
  const sorted = [...rawSpans].sort((a, b) => {
    if (a.startNs !== b.startNs) {
      return a.startNs < b.startNs ? -1 : 1;
    }
    if (b.durationNs === a.durationNs) {
      return 0;
    }
    return b.durationNs > a.durationNs ? 1 : -1;
  });

  const rowEndNs: bigint[] = [];
  const laidOut = sorted.map((span) => {
    let row = 0;
    while (row < rowEndNs.length && span.startNs < rowEndNs[row]) {
      row += 1;
    }
    if (rowEndNs[row] == null || span.endNs > rowEndNs[row]) {
      rowEndNs[row] = span.endNs;
    }
    return {
      ...span,
      row,
    };
  });

  return {
    rowCount: Math.max(rowEndNs.length, 1),
    spans: laidOut,
  };
}

function fillSpans(timelines: TraceTimeline[]): TraceTimeline[] {
  const sorted = [...timelines].sort((a, b) => {
    if (a.startNs === b.startNs) {
      return 0;
    }
    return a.startNs < b.startNs ? -1 : 1;
  });
  const filled = sorted.map((timeline, index) => {
    const nextTrace = sorted[index + 1];
    if (nextTrace == null) {
      return timeline;
    }
    const hasZeroGenerationDuration =
      timeline.generationStartNs != null &&
      timeline.generationCompletedNs != null &&
      timeline.generationStartNs === timeline.generationCompletedNs;

    const adjustedSpans = timeline.spans.map((span) => {
      if (nextTrace.startNs <= span.startNs) {
        return { ...span };
      }
      if (hasZeroGenerationDuration) {
        return {
          ...span,
          endNs: nextTrace.startNs,
          durationNs: nextTrace.startNs - span.startNs,
        };
      }
      if (span.startNs !== span.endNs) {
        return { ...span };
      }
      return {
        ...span,
        endNs: nextTrace.startNs,
        durationNs: nextTrace.startNs - span.startNs,
      };
    });

    const relayout = layoutSpans(
      adjustedSpans.map((span) => ({
        traceID: span.traceID,
        spanID: span.spanID,
        name: span.name,
        serviceName: span.serviceName,
        startNs: span.startNs,
        endNs: span.endNs,
        durationNs: span.durationNs,
        selectionID: span.selectionID,
      }))
    );

    return {
      ...timeline,
      rowCount: relayout.rowCount,
      spans: relayout.spans,
      startNs: relayout.spans.reduce(
        (min, span) => (span.startNs < min ? span.startNs : min),
        relayout.spans[0].startNs
      ),
      endNs: relayout.spans.reduce((max, span) => (span.endNs > max ? span.endNs : max), relayout.spans[0].endNs),
    };
  });

  return filled;
}

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

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    label: 'conversationDetailPage-pageContainer',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
  }),
  title: css({
    label: 'conversationDetailPage-title',
    margin: 0,
    padding: theme.spacing(2, 2, 1),
  }),
  loadingContainer: css({
    label: 'conversationDetailPage-loadingContainer',
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(4),
  }),
  detailsContainer: css({
    label: 'conversationDetailPage-detailsContainer',
    padding: theme.spacing(2),
    paddingTop: 0,
  }),
  traceTimelineContainer: css({
    label: 'conversationDetailPage-traceTimelineContainer',
    display: 'grid',
    gap: 0,
  }),
  traceTimelineEmpty: css({
    label: 'conversationDetailPage-traceTimelineEmpty',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  traceRow: css({
    label: 'conversationDetailPage-traceRow',
    display: 'block',
    borderRadius: theme.shape.radius.default,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  traceLane: css({
    label: 'conversationDetailPage-traceLane',
    position: 'relative' as const,
    overflow: 'visible' as const,
  }),
  traceTimeRange: css({
    label: 'conversationDetailPage-traceTimeRange',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: theme.spacing(0.5, 0),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  traceTimeLabel: css({
    label: 'conversationDetailPage-traceTimeLabel',
    whiteSpace: 'nowrap' as const,
  }),
  hoveredSpanTooltip: css({
    label: 'conversationDetailPage-hoveredSpanTooltip',
    position: 'absolute' as const,
    zIndex: 1,
    transform: 'translateX(-50%)',
    width: 'max-content',
    maxWidth: `min(560px, calc(100% - ${theme.spacing(2)}))`,
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
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
      borderBottom: `8px solid ${theme.colors.border.medium}`,
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
    label: 'conversationDetailPage-hoveredSpanTitle',
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  hoveredSpanMeta: css({
    label: 'conversationDetailPage-hoveredSpanMeta',
    color: theme.colors.text.secondary,
  }),
  hoveredSpanRow: css({
    label: 'conversationDetailPage-hoveredSpanRow',
    display: 'grid',
    gridTemplateColumns: '120px minmax(0, 1fr)',
    gap: theme.spacing(0.5),
    alignItems: 'baseline',
    wordBreak: 'break-word' as const,
  }),
  hoveredSpanLabel: css({
    label: 'conversationDetailPage-hoveredSpanLabel',
    color: theme.colors.text.secondary,
  }),
  hoveredSpanValue: css({
    label: 'conversationDetailPage-hoveredSpanValue',
    color: theme.colors.text.primary,
  }),
  spanBar: css({
    label: 'conversationDetailPage-spanBar',
    position: 'absolute' as const,
    height: `${TRACE_SPAN_HEIGHT_PX}px`,
    borderRadius: 2,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.text.disabled,
    color: theme.colors.primary.contrastText,
    fontSize: theme.typography.bodySmall.fontSize,
    padding: 0,
    cursor: 'pointer',
    ...(theme.isDark && {
      '&:hover': {
        background: '#fff',
        borderColor: '#fff',
      },
    }),
  }),
  spanBarRowHovered: css({
    label: 'conversationDetailPage-spanBarRowHovered',
    ...(theme.isDark && {
      background: '#fff',
      borderColor: '#fff',
    }),
  }),
  spanBarSelected: css({
    label: 'conversationDetailPage-spanBarSelected',
    background: theme.colors.warning.main,
    color: theme.colors.text.primary,
    borderColor: theme.colors.warning.border,
    boxShadow: `0 0 0 2px ${theme.colors.warning.transparent}`,
    '&:hover': {
      background: theme.colors.warning.main,
      color: theme.colors.text.primary,
      borderColor: theme.colors.warning.border,
    },
  }),
  selectedSpanCard: css({
    label: 'conversationDetailPage-selectedSpanCard',
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
    label: 'conversationDetailPage-selectedSpanSectionTitle',
    marginTop: theme.spacing(0.25),
    marginBottom: theme.spacing(0.5),
  }),
  selectedSpanGrid: css({
    label: 'conversationDetailPage-selectedSpanGrid',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: theme.spacing(1),
  }),
  selectedSpanGroup: css({
    label: 'conversationDetailPage-selectedSpanGroup',
    display: 'grid',
    gap: theme.spacing(0.375),
    padding: theme.spacing(0.75),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  selectedSpanRow: css({
    label: 'conversationDetailPage-selectedSpanRow',
    display: 'grid',
    gridTemplateColumns: 'minmax(120px, 150px) minmax(0, 1fr)',
    gap: theme.spacing(0.75),
    alignItems: 'baseline',
    wordBreak: 'break-word' as const,
  }),
  selectedSpanLabel: css({
    label: 'conversationDetailPage-selectedSpanLabel',
    color: theme.colors.text.secondary,
  }),
  selectedSpanValue: css({
    label: 'conversationDetailPage-selectedSpanValue',
    color: theme.colors.text.primary,
  }),
  rawData: css({
    label: 'conversationDetailPage-rawData',
    margin: 0,
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    overflowX: 'auto' as const,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});

export default function ConversationDetailPage(props: ConversationDetailPageProps) {
  const styles = useStyles2(getStyles);
  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const { conversationID = '' } = useParams<{ conversationID: string }>();
  const hasConversationID = conversationID.length > 0;
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [traceLoadTotal, setTraceLoadTotal] = useState<number>(0);
  const [traceLoadRunning, setTraceLoadRunning] = useState<boolean>(false);
  const [traceLoadFailures, setTraceLoadFailures] = useState<number>(0);
  const [traceTimelines, setTraceTimelines] = useState<TraceTimeline[]>([]);
  const [hoveredSpanSelectionID, setHoveredSpanSelectionID] = useState<string>('');
  const [hoveredSpanAnchor, setHoveredSpanAnchor] = useState<HoveredSpanAnchor | null>(null);
  const [hoveredTraceID, setHoveredTraceID] = useState<string>('');
  const [searchParams, setSearchParams] = useSearchParams();
  const requestVersionRef = useRef<number>(0);
  const traceRequestVersionRef = useRef<number>(0);
  const detailJSON = useMemo(() => {
    if (detail == null) {
      return '';
    }
    return JSON.stringify(detail, null, 2);
  }, [detail]);
  const selectedSpanID = searchParams.get('span') ?? '';
  const timelineBounds = useMemo(() => {
    let min: bigint | null = null;
    let max: bigint | null = null;
    for (const timeline of traceTimelines) {
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
  }, [traceTimelines]);
  const timelineScalePct = useMemo(() => {
    let maxRightPct = 100;
    for (const timeline of traceTimelines) {
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
  }, [timelineBounds.min, timelineBounds.range, traceTimelines]);
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
  const hoveredSpan = useMemo(() => {
    for (const timeline of traceTimelines) {
      for (const span of timeline.spans) {
        if (span.selectionID === hoveredSpanSelectionID) {
          return span;
        }
      }
    }
    return null;
  }, [hoveredSpanSelectionID, traceTimelines]);
  const selectedGeneration = useMemo(() => {
    return findGenerationForSpan(detail, selectedSpan);
  }, [detail, selectedSpan]);
  const hoveredGeneration = useMemo(() => {
    return findGenerationForSpan(detail, hoveredSpan);
  }, [detail, hoveredSpan]);
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

  useEffect(() => {
    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;

    if (!hasConversationID) {
      return;
    }

    setLoading(true);
    setErrorMessage('');

    void dataSource
      .getConversationDetail(conversationID)
      .then((response) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setDetail(response);
      })
      .catch((error) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversation');
        setDetail(null);
      })
      .finally(() => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setLoading(false);
      });
  }, [conversationID, dataSource, hasConversationID]);

  useEffect(() => {
    traceRequestVersionRef.current += 1;
    const requestVersion = traceRequestVersionRef.current;

    if (loading || detail == null) {
      setTraceLoadTotal(0);
      setTraceLoadRunning(false);
      setTraceLoadFailures(0);
      setTraceTimelines([]);
      return;
    }

    const traceToGeneration = new Map<string, (typeof detail.generations)[number]>();
    for (const generation of detail.generations) {
      if (typeof generation.trace_id !== 'string' || generation.trace_id.length === 0) {
        continue;
      }
      if (!traceToGeneration.has(generation.trace_id)) {
        traceToGeneration.set(generation.trace_id, generation);
      }
    }
    const traceIDs = Array.from(traceToGeneration.keys());

    setTraceLoadTotal(traceIDs.length);
    setTraceLoadFailures(0);
    setTraceTimelines([]);

    if (traceIDs.length === 0) {
      setTraceLoadRunning(false);
      return;
    }

    setTraceLoadRunning(true);
    void (async () => {
      const collected: TraceTimeline[] = [];
      for (const traceID of traceIDs) {
        if (traceRequestVersionRef.current !== requestVersion) {
          return;
        }

        const traceURL = new URL(
          `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/api/v2/traces/${encodeURIComponent(traceID)}`,
          window.location.origin
        );

        try {
          const response = await lastValueFrom(
            getBackendSrv().fetch<unknown>({
              method: 'GET',
              url: traceURL.toString(),
            })
          );
          const spans = buildTraceSpans(traceID, response.data);
          if (spans.length > 0) {
            const layout = layoutSpans(spans);
            const generation = traceToGeneration.get(traceID);
            const spanStart = layout.spans.reduce(
              (min, span) => (span.startNs < min ? span.startNs : min),
              layout.spans[0].startNs
            );
            const spanEnd = layout.spans.reduce(
              (max, span) => (span.endNs > max ? span.endNs : max),
              layout.spans[0].endNs
            );
            const generationStartNs = parseTimestampToNs(generation?.created_at);
            const generationCompletedNs = parseTimestampToNs(generation?.completed_at);
            collected.push({
              traceID,
              rowCount: layout.rowCount,
              spans: layout.spans,
              startNs: spanStart,
              endNs: spanEnd,
              generationStartNs,
              generationCompletedNs,
            });
            if (traceRequestVersionRef.current === requestVersion) {
              setTraceTimelines(fillSpans([...collected]));
            }
          }
        } catch (error) {
          console.error('[ConversationDetailPage] failed to preload trace', {
            conversation_id: detail.conversation_id,
            trace_id: traceID,
            error,
          });
          setTraceLoadFailures((current) => current + 1);
        } finally {
          if (traceRequestVersionRef.current !== requestVersion) {
            return;
          }
        }
      }

      if (traceRequestVersionRef.current === requestVersion) {
        const filledTimelines = fillSpans(collected);
        console.log('[ConversationDetailPage] loaded traces', {
          conversation_id: detail.conversation_id,
          trace_count: filledTimelines.length,
          traces: filledTimelines,
        });
        setTraceTimelines(filledTimelines);
        setTraceLoadRunning(false);
      }
    })();
  }, [detail, loading]);

  return (
    <div className={styles.pageContainer}>
      <h2 className={styles.title}>Conversation Detail</h2>
      {loading && (
        <div className={styles.loadingContainer}>
          <Spinner aria-label="loading conversation detail" />
        </div>
      )}
      {(errorMessage.length > 0 || !hasConversationID) && (
        <Alert severity="error" title="Failed to load conversation">
          {hasConversationID ? errorMessage : 'missing conversation id'}
        </Alert>
      )}
      {!loading && hasConversationID && detail != null && (
        <>
          <div className={styles.detailsContainer}>
            {traceLoadTotal > 0 && (
              <div className={styles.traceTimelineContainer}>
                {traceTimelines.length === 0 ? (
                  <div className={styles.traceTimelineEmpty}>
                    {traceLoadRunning ? 'Loading trace spans...' : 'No spans found in retrieved traces.'}
                  </div>
                ) : (
                  <>
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
                    {traceTimelines.map((timeline) => (
                      <div
                        key={timeline.traceID}
                        className={styles.traceRow}
                        data-testid={`trace-row-${timeline.traceID}`}
                        onMouseEnter={(event) => {
                          const firstSpan = timeline.spans[0];
                          if (firstSpan == null) {
                            return;
                          }
                          const laneElement = event.currentTarget.querySelector(
                            `.${styles.traceLane}`
                          ) as HTMLDivElement | null;
                          const laneWidthPx = laneElement?.clientWidth ?? 0;
                          setHoveredTraceID(timeline.traceID);
                          setHoveredSpanSelectionID(firstSpan.selectionID);
                          setHoveredSpanAnchor(
                            getHoveredSpanAnchor(firstSpan, timelineBounds, laneWidthPx, timelineScalePct)
                          );
                        }}
                        onMouseLeave={() => {
                          setHoveredTraceID('');
                          setHoveredSpanSelectionID('');
                          setHoveredSpanAnchor(null);
                        }}
                        onClick={() => {
                          const firstSpan = timeline.spans[0];
                          if (firstSpan == null) {
                            return;
                          }
                          setSelectedSpanParam(firstSpan.selectionID);
                        }}
                      >
                        <div
                          className={styles.traceLane}
                          style={{
                            height: `${timeline.rowCount * TRACE_ROW_STEP_PX + TRACE_LANE_PADDING_Y_PX * 2}px`,
                          }}
                        >
                          {timeline.spans.map((span) => {
                            const rawLeftPct = ratioToPercent(span.startNs - timelineBounds.min, timelineBounds.range);
                            const boundedWidthPct = Math.min(
                              Math.max(ratioToPercent(span.durationNs, timelineBounds.range), TRACE_MIN_SPAN_WIDTH_PCT),
                              100
                            );
                            const scaledLeftPct = Math.max(0, rawLeftPct * timelineScalePct);
                            const scaledWidthPct = Math.max(0, boundedWidthPct * timelineScalePct);
                            const isSelected = selectedSpanID === span.selectionID;
                            const isRowHovered = hoveredTraceID === timeline.traceID;
                            return (
                              <React.Fragment key={`${span.selectionID}:${span.row}`}>
                                <button
                                  type="button"
                                  className={`${styles.spanBar} ${
                                    isRowHovered && !isSelected ? styles.spanBarRowHovered : ''
                                  } ${isSelected ? styles.spanBarSelected : ''}`}
                                  style={{
                                    top: `${span.row * TRACE_ROW_STEP_PX}px`,
                                    left: `${scaledLeftPct}%`,
                                    width: `${scaledWidthPct}%`,
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
                                    style={{
                                      top: `${hoveredSpanAnchor.topPx}px`,
                                      left: hoveredSpanAnchor.left,
                                      maxWidth:
                                        hoveredSpanAnchor.maxWidthPx != null
                                          ? `${hoveredSpanAnchor.maxWidthPx}px`
                                          : undefined,
                                    }}
                                  >
                                    <div className={styles.hoveredSpanTitle}>{hoveredSpan.name}</div>
                                    <div className={styles.hoveredSpanMeta}>{hoveredSpan.serviceName}</div>
                                    <div className={styles.hoveredSpanRow}>
                                      <span className={styles.hoveredSpanLabel}>Time range</span>
                                      <span className={styles.hoveredSpanValue}>
                                        {formatNsTimestamp(hoveredSpan.startNs)} -{' '}
                                        {formatNsTimestamp(hoveredSpan.endNs)}
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
                                      <span className={styles.hoveredSpanValue}>
                                        {hoveredSpan.spanID || 'unknown-span'}
                                      </span>
                                    </div>
                                    {hoveredGeneration != null && (
                                      <>
                                        <div className={styles.hoveredSpanRow}>
                                          <span className={styles.hoveredSpanLabel}>Generation ID</span>
                                          <span className={styles.hoveredSpanValue}>
                                            {hoveredGeneration.generation_id}
                                          </span>
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
                                          <span className={styles.hoveredSpanValue}>
                                            {hoveredGeneration.mode ?? 'n/a'}
                                          </span>
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
                    ))}
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
                {selectedSpan != null && (
                  <div className={styles.selectedSpanCard}>
                    <strong className={styles.selectedSpanSectionTitle}>Selected span details</strong>
                    <div className={styles.selectedSpanGrid}>
                      <div className={styles.selectedSpanGroup}>
                        <div className={styles.selectedSpanRow}>
                          <span className={styles.selectedSpanLabel}>Name</span>
                          <span className={styles.selectedSpanValue}>{selectedSpan.name}</span>
                        </div>
                        <div className={styles.selectedSpanRow}>
                          <span className={styles.selectedSpanLabel}>Service</span>
                          <span className={styles.selectedSpanValue}>{selectedSpan.serviceName}</span>
                        </div>
                        <div className={styles.selectedSpanRow}>
                          <span className={styles.selectedSpanLabel}>Trace ID</span>
                          <span className={styles.selectedSpanValue}>{selectedSpan.traceID}</span>
                        </div>
                        <div className={styles.selectedSpanRow}>
                          <span className={styles.selectedSpanLabel}>Span ID</span>
                          <span className={styles.selectedSpanValue}>{selectedSpan.spanID || 'unknown-span'}</span>
                        </div>
                        <div className={styles.selectedSpanRow}>
                          <span className={styles.selectedSpanLabel}>Start</span>
                          <span className={styles.selectedSpanValue}>{formatNsTimestamp(selectedSpan.startNs)}</span>
                        </div>
                        <div className={styles.selectedSpanRow}>
                          <span className={styles.selectedSpanLabel}>End</span>
                          <span className={styles.selectedSpanValue}>{formatNsTimestamp(selectedSpan.endNs)}</span>
                        </div>
                        <div className={styles.selectedSpanRow}>
                          <span className={styles.selectedSpanLabel}>Duration</span>
                          <span className={styles.selectedSpanValue}>{formatNsDuration(selectedSpan.durationNs)}</span>
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
                              <span className={styles.selectedSpanValue}>
                                {selectedGeneration.stop_reason ?? 'n/a'}
                              </span>
                            </div>
                            <div className={styles.selectedSpanRow}>
                              <span className={styles.selectedSpanLabel}>Created at</span>
                              <span className={styles.selectedSpanValue}>{selectedGeneration.created_at ?? 'n/a'}</span>
                            </div>
                            <div className={styles.selectedSpanRow}>
                              <span className={styles.selectedSpanLabel}>Completed at</span>
                              <span className={styles.selectedSpanValue}>
                                {String(selectedGeneration.completed_at ?? 'n/a')}
                              </span>
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
                              <span className={styles.selectedSpanValue}>
                                {selectedGeneration.error?.message ?? 'none'}
                              </span>
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
            )}
          </div>
          <pre className={styles.rawData}>{detailJSON}</pre>
        </>
      )}
    </div>
  );
}
