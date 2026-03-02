import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Alert, Spinner, useStyles2 } from '@grafana/ui';
import { lastValueFrom } from 'rxjs';
import { useParams, useSearchParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationDetail } from '../conversation/types';

export type ConversationDetailPageProps = {
  dataSource?: ConversationsDataSource;
};

const TRACE_ROW_STEP_PX = 16;
const TRACE_SPAN_HEIGHT_PX = 14;
const TRACE_LANE_PADDING_Y_PX = (TRACE_ROW_STEP_PX - TRACE_SPAN_HEIGHT_PX) / 2;

type TraceSpan = {
  traceID: string;
  spanID: string;
  name: string;
  serviceName: string;
  startNs: number;
  endNs: number;
  durationNs: number;
  row: number;
  selectionID: string;
};

type TraceTimeline = {
  traceID: string;
  rowCount: number;
  spans: TraceSpan[];
  startNs: number;
  endNs: number;
  generationStartNs: number | null;
  generationCompletedNs: number | null;
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

function parseNs(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseTimestampToNs(raw: unknown): number | null {
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
  return parsedMs * 1_000_000;
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
            durationNs: Math.max(safeEnd - startNs, 1),
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
      return a.startNs - b.startNs;
    }
    return b.durationNs - a.durationNs;
  });

  const rowEndNs: number[] = [];
  const laidOut = sorted.map((span) => {
    let row = 0;
    while (row < rowEndNs.length && span.startNs < rowEndNs[row]) {
      row += 1;
    }
    rowEndNs[row] = Math.max(rowEndNs[row] ?? 0, span.endNs);
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
  const sorted = [...timelines].sort((a, b) => a.startNs - b.startNs);
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
      startNs: Math.min(...relayout.spans.map((span) => span.startNs)),
      endNs: Math.max(...relayout.spans.map((span) => span.endNs)),
    };
  });

  return filled;
}

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
  }),
  title: css({
    padding: theme.spacing(3),
  }),
  loadingContainer: css({
    display: 'flex',
    justifyContent: 'center',
    padding: theme.spacing(4),
  }),
  detailsContainer: css({
    padding: theme.spacing(2),
  }),
  traceTimelineContainer: css({
    display: 'grid',
    gap: 0,
    marginTop: theme.spacing(2),
  }),
  traceTimelineHeader: css({
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  traceTimelineEmpty: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  traceRow: css({
    display: 'block',
    borderRadius: theme.shape.radius.default,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  traceLane: css({
    position: 'relative' as const,
    minHeight: '24px',
    paddingTop: `${TRACE_LANE_PADDING_Y_PX}px`,
    paddingBottom: `${TRACE_LANE_PADDING_Y_PX}px`,
    overflow: 'visible' as const,
  }),
  spanBar: css({
    position: 'absolute' as const,
    height: `${TRACE_SPAN_HEIGHT_PX}px`,
    borderRadius: 2,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    fontSize: theme.typography.bodySmall.fontSize,
    padding: 0,
    cursor: 'pointer',
  }),
  spanBarSelected: css({
    background: theme.colors.warning.main,
    color: theme.colors.text.primary,
    borderColor: theme.colors.warning.border,
    boxShadow: `0 0 0 2px ${theme.colors.warning.transparent}`,
  }),
  selectedSpanCard: css({
    marginTop: theme.spacing(1),
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    display: 'grid',
    gap: theme.spacing(0.5),
  }),
  traceProgressContainer: css({
    display: 'grid',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(1),
  }),
  traceProgressTrack: css({
    width: '100%',
    height: '8px',
    borderRadius: '999px',
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden' as const,
  }),
  traceProgressFill: css({
    height: '100%',
    background: theme.colors.primary.main,
    transition: 'width 150ms ease',
  }),
  metaRow: css({
    display: 'grid',
    gridTemplateColumns: '180px 1fr',
    gap: theme.spacing(0.75),
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  rawData: css({
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
  const [traceLoadDone, setTraceLoadDone] = useState<number>(0);
  const [traceLoadRunning, setTraceLoadRunning] = useState<boolean>(false);
  const [traceLoadFailures, setTraceLoadFailures] = useState<number>(0);
  const [traceTimelines, setTraceTimelines] = useState<TraceTimeline[]>([]);
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
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    for (const timeline of traceTimelines) {
      if (timeline.startNs < min) {
        min = timeline.startNs;
      }
      if (timeline.endNs > max) {
        max = timeline.endNs;
      }
    }
    if (!Number.isFinite(min) || max <= min) {
      return { min: 0, range: 1 };
    }
    return { min, range: max - min };
  }, [traceTimelines]);
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
      setTraceLoadDone(0);
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
    setTraceLoadDone(0);
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
            const spanStart = Math.min(...layout.spans.map((span) => span.startNs));
            const spanEnd = Math.max(...layout.spans.map((span) => span.endNs));
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
          setTraceLoadDone((current) => current + 1);
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
            <div className={styles.metaRow}>
              <strong>Conversation ID</strong>
              <span>{detail.conversation_id}</span>
              <strong>Generation count</strong>
              <span>{detail.generation_count}</span>
              <strong>First generation</strong>
              <span>{detail.first_generation_at}</span>
              <strong>Last generation</strong>
              <span>{detail.last_generation_at}</span>
            </div>
            {traceLoadRunning && traceLoadTotal > 0 && (
              <div className={styles.traceProgressContainer}>
                <div
                  className={styles.traceProgressTrack}
                  role="progressbar"
                  aria-label="Trace preload progress"
                  aria-valuemin={0}
                  aria-valuemax={traceLoadTotal}
                  aria-valuenow={traceLoadDone}
                >
                  <div
                    className={styles.traceProgressFill}
                    style={{
                      width: `${Math.round((traceLoadDone / traceLoadTotal) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
            {traceLoadTotal > 0 && !traceLoadRunning && (
              <div className={styles.traceTimelineContainer}>
                <div className={styles.traceTimelineHeader}>Trace timeline</div>
                {traceTimelines.length === 0 ? (
                  <div className={styles.traceTimelineEmpty}>No spans found in retrieved traces.</div>
                ) : (
                  traceTimelines.map((timeline) => (
                    <div
                      key={timeline.traceID}
                      className={styles.traceRow}
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
                          const leftPct = ((span.startNs - timelineBounds.min) / timelineBounds.range) * 100;
                          const widthPct = Math.max((span.durationNs / timelineBounds.range) * 100, 0.8);
                          const isSelected = selectedSpanID === span.selectionID;
                          return (
                            <button
                              key={`${span.selectionID}:${span.row}`}
                              type="button"
                              className={`${styles.spanBar} ${isSelected ? styles.spanBarSelected : ''}`}
                              style={{
                                top: `${span.row * TRACE_ROW_STEP_PX}px`,
                                left: `${leftPct}%`,
                                width: `${Math.max(0.8, Math.min(widthPct, 100 - leftPct))}%`,
                              }}
                              aria-label={`select span ${span.name}`}
                              aria-pressed={isSelected}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedSpanParam(span.selectionID);
                              }}
                              title={`${span.name} (${span.serviceName})`}
                            >
                              {null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
                {selectedSpan != null && (
                  <div className={styles.selectedSpanCard}>
                    <strong>Selected span</strong>
                    <div>{selectedSpan.name}</div>
                    <div>
                      {selectedSpan.traceID} / {selectedSpan.spanID || 'unknown-span'}
                    </div>
                    <div>{selectedSpan.serviceName}</div>
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
