import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Spinner, useStyles2 } from '@grafana/ui';
import { useParams, useSearchParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import { createTempoTraceFetcher } from '../conversation/fetchTrace';
import { type TraceFetcher } from '../conversation/loader';
import { findSpanBySelectionID, getSelectionID } from '../conversation/spans';
import type { ConversationSearchResult, ConversationSpan } from '../conversation/types';
import { defaultModelCardClient, type ModelCardClient } from '../modelcard/api';
import { useConversationData } from '../hooks/useConversationData';
import ConversationGenerations from '../components/conversations/ConversationGenerations';
import ConversationSummaryHeader from '../components/conversations/ConversationSummaryHeader';
import SpanDetailPanel from '../components/conversations/SpanDetailPanel';

export type ConversationPageProps = {
  dataSource?: ConversationsDataSource;
  traceFetcher?: TraceFetcher;
  modelCardClient?: ModelCardClient;
};

const defaultTraceFetcher = createTempoTraceFetcher();

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    label: 'conversationPage-pageContainer',
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    overflow: 'hidden',
  }),
  spinnerWrap: css({
    label: 'conversationPage-spinnerWrap',
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  }),
  errorWrap: css({
    label: 'conversationPage-errorWrap',
    padding: theme.spacing(2),
  }),
  contentArea: css({
    label: 'conversationPage-contentArea',
    flex: 1,
    display: 'flex',
    flexDirection: 'row' as const,
    minHeight: 0,
    overflow: 'hidden',
  }),
  middlePanel: css({
    label: 'conversationPage-middlePanel',
    minHeight: 0,
    overflow: 'hidden',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
  }),
  splitterHandle: css({
    label: 'conversationPage-splitterHandle',
    width: '6px',
    flexShrink: 0,
    cursor: 'col-resize',
    position: 'relative',
    zIndex: 2,
    '&::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: '2px',
      width: '2px',
      background: theme.colors.border.weak,
      transition: 'background 150ms ease',
    },
    '&:hover::before': {
      background: theme.colors.primary.main,
    },
  }),
  splitterHandleDragging: css({
    label: 'conversationPage-splitterHandleDragging',
    '&::before': {
      background: theme.colors.primary.main,
    },
  }),
  detailPanel: css({
    label: 'conversationPage-detailPanel',
    minHeight: 0,
    overflowY: 'auto' as const,
    minWidth: 0,
  }),
  detailPlaceholder: css({
    label: 'conversationPage-detailPlaceholder',
    flex: 1,
    minHeight: 0,
    border: `1px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.colors.text.secondary,
    padding: theme.spacing(2),
    margin: theme.spacing(2),
  }),
});

export default function ConversationPage(props: ConversationPageProps) {
  const styles = useStyles2(getStyles);
  const { conversationID = '' } = useParams<{ conversationID?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const traceFetcher = props.traceFetcher ?? defaultTraceFetcher;
  const modelCardClient = props.modelCardClient ?? defaultModelCardClient;

  const {
    conversationData,
    loading,
    tracesLoading,
    errorMessage,
    tokenSummary,
    costSummary,
    modelCards,
    allGenerations,
  } = useConversationData({ conversationID, dataSource, traceFetcher, modelCardClient });

  const [splitterRatio, setSplitterRatio] = useState(0.55);
  const [isSplitterDragging, setIsSplitterDragging] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);

  const handleSplitterMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setIsSplitterDragging(true);
      const startX = event.clientX;
      const startRatio = splitterRatio;
      const layoutEl = layoutRef.current;
      if (!layoutEl) {
        return;
      }
      const layoutWidth = layoutEl.getBoundingClientRect().width;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const newRatio = startRatio + delta / layoutWidth;
        setSplitterRatio(Math.max(0.25, Math.min(0.75, newRatio)));
      };

      const handleMouseUp = () => {
        setIsSplitterDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [splitterRatio]
  );

  const selectedSpanSelectionID = searchParams.get('span') ?? '';
  const conversationTitleFromURL = (searchParams.get('conversationTitle') ?? '').trim();
  const selectedSpan = useMemo(() => {
    if (selectedSpanSelectionID.length === 0 || !conversationData) {
      return null;
    }
    return findSpanBySelectionID(conversationData.spans, selectedSpanSelectionID);
  }, [selectedSpanSelectionID, conversationData]);

  const previousConversationIDRef = useRef<string>(conversationID);
  useEffect(() => {
    if (previousConversationIDRef.current === conversationID) {
      return;
    }
    previousConversationIDRef.current = conversationID;

    const next = new URLSearchParams(searchParams);
    if (!next.has('span') && !next.has('trace')) {
      return;
    }
    next.delete('span');
    next.delete('trace');
    setSearchParams(next, { replace: true });
  }, [conversationID, searchParams, setSearchParams]);

  const onSelectSpan = useCallback(
    (span: ConversationSpan | null) => {
      const next = new URLSearchParams(searchParams);
      if (span == null) {
        next.delete('span');
        next.delete('trace');
      } else {
        next.set('span', getSelectionID(span));
        next.set('trace', span.traceID);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const conversationSummary = useMemo<ConversationSearchResult | null>(() => {
    if (!conversationData) {
      return null;
    }
    const errorCount = allGenerations.filter((g) => Boolean(g.error?.message)).length;
    return {
      conversation_id: conversationData.conversationID,
      conversation_title:
        conversationData.conversationTitle?.trim() ||
        (conversationTitleFromURL.length > 0 ? conversationTitleFromURL : undefined),
      user_id: conversationData.userID,
      generation_count: conversationData.generationCount,
      first_generation_at: conversationData.firstGenerationAt,
      last_generation_at: conversationData.lastGenerationAt,
      models: Array.from(new Set(allGenerations.map((g) => g.model?.name).filter((n): n is string => Boolean(n)))),
      agents: Array.from(new Set(allGenerations.map((g) => g.agent_name).filter((n): n is string => Boolean(n)))),
      error_count: errorCount,
      has_errors: errorCount > 0,
      trace_ids: [],
      rating_summary: conversationData.ratingSummary ?? undefined,
      annotation_count: conversationData.annotations.length,
    };
  }, [conversationData, allGenerations, conversationTitleFromURL]);

  return (
    <div className={styles.pageContainer}>
      {loading ? (
        <div className={styles.spinnerWrap}>
          <Spinner aria-label="loading conversation" />
        </div>
      ) : errorMessage.length > 0 ? (
        <div className={styles.errorWrap}>
          <Alert severity="error" title="Failed to load conversation">
            {errorMessage}
          </Alert>
        </div>
      ) : conversationData && conversationSummary ? (
        <>
          <ConversationSummaryHeader
            conversation={conversationSummary}
            modelCards={modelCards}
            tokenSummary={tokenSummary}
            costSummary={costSummary}
          />
          <div ref={layoutRef} className={styles.contentArea}>
            <div
              className={styles.middlePanel}
              style={{ flexBasis: `${splitterRatio * 100}%`, maxWidth: `${splitterRatio * 100}%` }}
            >
              <ConversationGenerations
                data={conversationData}
                loading={tracesLoading}
                selectedSpanSelectionID={selectedSpanSelectionID}
                onSelectSpan={onSelectSpan}
              />
            </div>
            <div
              className={`${styles.splitterHandle} ${isSplitterDragging ? styles.splitterHandleDragging : ''}`}
              onMouseDown={handleSplitterMouseDown}
              role="separator"
              aria-label="resize panels"
            />
            <div className={styles.detailPanel} style={{ flex: 1 }}>
              {selectedSpan != null ? (
                <SpanDetailPanel span={selectedSpan} allGenerations={allGenerations} />
              ) : (
                <div className={styles.detailPlaceholder}>Select a span to view details.</div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
