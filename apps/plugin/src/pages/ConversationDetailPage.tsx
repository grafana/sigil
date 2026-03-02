import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Alert, Spinner, useStyles2 } from '@grafana/ui';
import { lastValueFrom } from 'rxjs';
import { useParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationDetail } from '../conversation/types';

export type ConversationDetailPageProps = {
  dataSource?: ConversationsDataSource;
};

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
  const requestVersionRef = useRef<number>(0);
  const traceRequestVersionRef = useRef<number>(0);
  const detailJSON = useMemo(() => {
    if (detail == null) {
      return '';
    }
    const { generations: _generations, ...detailWithoutGenerations } = detail;
    return JSON.stringify(detailWithoutGenerations, null, 2);
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
      setTraceLoadDone(0);
      setTraceLoadRunning(false);
      return;
    }

    const traceIDs = detail.generations
      .map((generation) => generation.trace_id)
      .filter((traceID): traceID is string => typeof traceID === 'string' && traceID.length > 0);

    setTraceLoadTotal(traceIDs.length);
    setTraceLoadDone(0);

    if (traceIDs.length === 0) {
      setTraceLoadRunning(false);
      return;
    }

    setTraceLoadRunning(true);
    void (async () => {
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
          console.log('[ConversationDetailPage] preloaded trace', {
            conversation_id: detail.conversation_id,
            trace_id: traceID,
            trace: response.data,
          });
        } catch (error) {
          console.error('[ConversationDetailPage] failed to preload trace', {
            conversation_id: detail.conversation_id,
            trace_id: traceID,
            error,
          });
        } finally {
          if (traceRequestVersionRef.current !== requestVersion) {
            return;
          }
          setTraceLoadDone((current) => current + 1);
        }
      }

      if (traceRequestVersionRef.current === requestVersion) {
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
          </div>
          <pre className={styles.rawData}>{detailJSON}</pre>
        </>
      )}
    </div>
  );
}
