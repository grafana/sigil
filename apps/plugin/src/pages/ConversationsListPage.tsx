import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Text, useStyles2 } from '@grafana/ui';
import { useNavigate } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationSearchResult } from '../conversation/types';
import { buildConversationDetailRoute } from '../constants';
import ConversationListPanel from '../components/conversations/ConversationListPanel';

type ActivityBucket = {
  key: string;
  label: string;
  minCalls: number;
  maxCalls?: number;
  count: number;
  conversationIDs: Set<string>;
};

function buildActivityBuckets(conversations: ConversationSearchResult[]): ActivityBucket[] {
  if (conversations.length === 0) {
    return [];
  }

  const maxCalls = conversations.reduce((max, item) => Math.max(max, item.generation_count), 0);
  const bucketDefinitions: Array<{ minCalls: number; maxCalls?: number }> = [
    { minCalls: 0, maxCalls: 0 },
    { minCalls: 1, maxCalls: 1 },
    { minCalls: 2, maxCalls: 2 },
    { minCalls: 3, maxCalls: 3 },
    { minCalls: 4, maxCalls: 4 },
    { minCalls: 5, maxCalls: 5 },
    { minCalls: 6, maxCalls: 7 },
    { minCalls: 8, maxCalls: 9 },
    { minCalls: 10, maxCalls: 14 },
    { minCalls: 15, maxCalls: 19 },
    { minCalls: 20, maxCalls: 29 },
    { minCalls: 30, maxCalls: 39 },
    { minCalls: 40, maxCalls: 59 },
    { minCalls: 60, maxCalls: 79 },
    { minCalls: 80, maxCalls: 119 },
    { minCalls: 120, maxCalls: 199 },
    { minCalls: 200 },
  ];

  const buckets: ActivityBucket[] = bucketDefinitions
    .filter((definition) => {
      if (definition.maxCalls == null) {
        return maxCalls >= definition.minCalls;
      }
      return definition.minCalls <= maxCalls;
    })
    .map((definition) => {
      const maxCallsForLabel = definition.maxCalls;
      const label =
        maxCallsForLabel == null
          ? `${definition.minCalls}+`
          : definition.minCalls === maxCallsForLabel
            ? `${definition.minCalls}`
            : `${definition.minCalls}-${maxCallsForLabel}`;

      return {
        key: maxCallsForLabel == null ? `${definition.minCalls}-plus` : `${definition.minCalls}-${maxCallsForLabel}`,
        label,
        minCalls: definition.minCalls,
        maxCalls: maxCallsForLabel,
        count: 0,
        conversationIDs: new Set<string>(),
      };
    });

  for (const conversation of conversations) {
    const bucket = buckets.find((entry) => {
      if (entry.maxCalls == null) {
        return conversation.generation_count >= entry.minCalls;
      }
      return conversation.generation_count >= entry.minCalls && conversation.generation_count <= entry.maxCalls;
    });
    if (bucket == null) {
      continue;
    }
    bucket.count += 1;
    bucket.conversationIDs.add(conversation.conversation_id);
  }

  return buckets.filter((bucket) => bucket.count > 0);
}

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(2),
    minHeight: 0,
  }),
  listContainer: css({
    minHeight: 0,
    flex: 1,
    overflow: 'hidden',
  }),
  chartPanel: css({
    minHeight: 240,
    margin: theme.spacing(0, 2),
    padding: theme.spacing(1.5),
  }),
  chartTitle: css({
    marginBottom: theme.spacing(1),
  }),
  chartBars: css({
    display: 'flex',
    alignItems: 'end',
    gap: theme.spacing(0.75),
    overflowX: 'auto' as const,
    minHeight: 180,
    paddingBottom: theme.spacing(0.5),
  }),
  chartBar: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    minWidth: 64,
    height: 180,
    display: 'flex',
    alignItems: 'end',
    justifyContent: 'stretch',
    padding: theme.spacing(0.5),
    flex: '0 0 auto',
    whiteSpace: 'normal' as const,
    textAlign: 'center' as const,
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  chartBarActive: css({
    borderColor: theme.colors.primary.main,
    background: theme.colors.primary.transparent,
  }),
  chartBarContent: css({
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
  }),
  chartBarFillArea: css({
    flex: 1,
    display: 'flex',
    alignItems: 'end',
  }),
  chartBarFill: css({
    width: '100%',
    borderRadius: theme.shape.radius.default,
    background: theme.colors.primary.main,
    opacity: 0.85,
    minHeight: 4,
  }),
  chartBarMeta: css({
    marginTop: theme.spacing(0.5),
    lineHeight: 1.25,
  }),
  activityCount: css({
    color: theme.colors.text.secondary,
    marginLeft: theme.spacing(0.5),
  }),
});

export type ConversationsListPageProps = {
  dataSource?: ConversationsDataSource;
};

export default function ConversationsListPage(props: ConversationsListPageProps) {
  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const navigate = useNavigate();
  const styles = useStyles2(getStyles);

  const [conversations, setConversations] = useState<ConversationSearchResult[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedBucketKey, setSelectedBucketKey] = useState<string>('');

  const requestVersionRef = useRef<number>(0);

  const loadConversations = useCallback(
    async (): Promise<void> => {
      requestVersionRef.current += 1;
      const requestVersion = requestVersionRef.current;

      setLoading(true);
      setErrorMessage('');

      try {
        if (dataSource.listConversations == null) {
          throw new Error('list conversations data source is not configured');
        }
        const response = await dataSource.listConversations();
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setConversations(
          (response?.items ?? []).map((item) => ({
            conversation_id: item.id,
            generation_count: item.generation_count,
            first_generation_at: item.created_at,
            last_generation_at: item.last_generation_at,
            models: [],
            agents: [],
            error_count: 0,
            has_errors: false,
            trace_ids: [],
            rating_summary: item.rating_summary,
            annotation_count: 0,
          }))
        );
        setSelectedBucketKey('');
      } catch (error) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversations');
        setConversations([]);
        setSelectedBucketKey('');
      } finally {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setLoading(false);
      }
    },
    [dataSource]
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const activityBuckets = useMemo(() => buildActivityBuckets(conversations), [conversations]);

  const selectedBucket = useMemo(
    () => activityBuckets.find((bucket) => bucket.key === selectedBucketKey),
    [activityBuckets, selectedBucketKey]
  );

  const filteredConversations = useMemo(() => {
    if (!selectedBucket) {
      return [];
    }
    return conversations.filter((conversation) => selectedBucket.conversationIDs.has(conversation.conversation_id));
  }, [conversations, selectedBucket]);

  const maxBucketCount = useMemo(
    () => activityBuckets.reduce((max, bucket) => Math.max(max, bucket.count), 0),
    [activityBuckets]
  );

  return (
    <div className={styles.pageContainer}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Conversation query failed">
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.chartPanel}>
        <div className={styles.chartTitle}>
          <Text element="h4">Conversations by LLM calls</Text>
          <Text color="secondary">Click a bar to filter conversations by generation_count bucket.</Text>
        </div>

        {activityBuckets.length > 0 && (
          <div className={styles.chartBars}>
            {activityBuckets.map((bucket) => {
              const active = selectedBucketKey === bucket.key;
              const fillPercent = maxBucketCount > 0 ? Math.max(2, (bucket.count / maxBucketCount) * 100) : 2;
              return (
                <button
                  key={bucket.key}
                  type="button"
                  className={`${styles.chartBar} ${active ? styles.chartBarActive : ''}`}
                  onClick={() => setSelectedBucketKey(bucket.key)}
                  aria-pressed={active}
                  aria-label={`Filter conversations with ${bucket.label} LLM calls`}
                >
                  <div className={styles.chartBarContent}>
                    <div className={styles.chartBarFillArea}>
                      <div className={styles.chartBarFill} style={{ height: `${fillPercent}%` }} />
                    </div>
                    <div className={styles.chartBarMeta}>
                      <div>{bucket.label}</div>
                      <div className={styles.activityCount}>{bucket.count}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

      </div>

      {(errorMessage.length === 0 || conversations.length > 0) && selectedBucket != null && (
        <div className={styles.listContainer}>
          <ConversationListPanel
            conversations={filteredConversations}
            selectedConversationId=""
            loading={loading}
            hasMore={false}
            loadingMore={false}
            onSelectConversation={(conversationID) => navigate(`/${buildConversationDetailRoute(conversationID)}`)}
            onLoadMore={() => undefined}
          />
        </div>
      )}
    </div>
  );
}
