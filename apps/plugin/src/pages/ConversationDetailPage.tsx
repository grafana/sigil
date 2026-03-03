import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Alert, Spinner, useStyles2 } from '@grafana/ui';
import { lastValueFrom } from 'rxjs';
import { useParams } from 'react-router-dom';
import ConversationTraces, {
  buildTraceSpans,
  layoutSpans,
  type TraceTimeline,
} from '../components/conversation/ConversationTraces';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationDetail } from '../conversation/types';

export type ConversationDetailPageProps = {
  dataSource?: ConversationsDataSource;
};

const TRACE_SPAN_HEIGHT_PX = 14;

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
    cursor: 'pointer',
  }),
  traceLane: css({
    label: 'conversationDetailPage-traceLane',
    position: 'relative' as const,
    overflow: 'visible' as const,
    cursor: 'pointer',
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
  traceZoomHeader: css({
    label: 'conversationDetailPage-traceZoomHeader',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: theme.spacing(0.5),
    gap: theme.spacing(1),
  }),
  traceZoomLabel: css({
    label: 'conversationDetailPage-traceZoomLabel',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  traceZoomBackButton: css({
    label: 'conversationDetailPage-traceZoomBackButton',
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
    label: 'conversationDetailPage-traceZoomBackArrow',
    fontFamily: theme.typography.fontFamilyMonospace,
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
    opacity: 0.7,
    transition: 'opacity 0.12s ease, box-shadow 0.12s ease',
  }),
  spanBarRowHovered: css({
    label: 'conversationDetailPage-spanBarRowHovered',
    opacity: 0.86,
  }),
  spanBarSelected: css({
    label: 'conversationDetailPage-spanBarSelected',
    opacity: 1,
    boxShadow: `0 0 0 2px ${theme.colors.primary.transparent}`,
  }),
  spanRowBackground: css({
    label: 'conversationDetailPage-spanRowBackground',
    position: 'absolute' as const,
    left: 0,
    width: '100%',
    borderRadius: 2,
    opacity: 0,
    pointerEvents: 'none' as const,
    transition: 'opacity 0.12s ease',
  }),
  spanRowBackgroundHovered: css({
    label: 'conversationDetailPage-spanRowBackgroundHovered',
    opacity: 0.12,
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
  const requestVersionRef = useRef<number>(0);
  const traceRequestVersionRef = useRef<number>(0);
  const detailJSON = useMemo(() => {
    if (detail == null) {
      return '';
    }
    return JSON.stringify(detail, null, 2);
  }, [detail]);

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
            const spanStart = layout.spans.reduce(
              (min, span) => (span.startNs < min ? span.startNs : min),
              layout.spans[0].startNs
            );
            const spanEnd = layout.spans.reduce(
              (max, span) => (span.endNs > max ? span.endNs : max),
              layout.spans[0].endNs
            );
            collected.push({
              traceID,
              rowCount: layout.rowCount,
              spans: layout.spans,
              startNs: spanStart,
              endNs: spanEnd,
            });
            if (traceRequestVersionRef.current === requestVersion) {
              setTraceTimelines([...collected]);
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
        console.log('[ConversationDetailPage] loaded traces', {
          conversation_id: detail.conversation_id,
          trace_count: collected.length,
          traces: collected,
        });
        setTraceTimelines(collected);
        setTraceLoadRunning(false);
      }
    })();
  }, [detail, loading]);

  return (
    <div className={styles.pageContainer}>
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
            <ConversationTraces
              detail={detail}
              traceLoadTotal={traceLoadTotal}
              traceLoadRunning={traceLoadRunning}
              traceLoadFailures={traceLoadFailures}
              traceTimelines={traceTimelines}
            />
          </div>
          <pre className={styles.rawData}>{detailJSON}</pre>
        </>
      )}
    </div>
  );
}
