import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Text, useStyles2 } from '@grafana/ui';
import { useNavigate } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationSearchRequest, ConversationSearchResult } from '../conversation/types';
import { buildConversationDetailRoute } from '../constants';
import ConversationListPanel from '../components/conversations/ConversationListPanel';

const ALL_TIME_RANGE_START = '1970-01-01T00:00:00.000Z';

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
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string>('');
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const requestVersionRef = useRef<number>(0);

  const loadConversations = useCallback(
    async (cursor = '', append = false): Promise<void> => {
      requestVersionRef.current += 1;
      const requestVersion = requestVersionRef.current;

      const request: ConversationSearchRequest = {
        filters: '',
        select: [],
        time_range: {
          from: ALL_TIME_RANGE_START,
          to: new Date().toISOString(),
        },
        page_size: 50,
        cursor: cursor || undefined,
      };

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setErrorMessage('');

      try {
        const response = await dataSource.searchConversations(request);
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setConversations((current) =>
          append ? [...current, ...(response.conversations ?? [])] : (response.conversations ?? [])
        );
        setNextCursor(response.next_cursor ?? '');
        setHasMore(Boolean(response.has_more));
      } catch (error) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversations');
        if (!append) {
          setConversations([]);
          setNextCursor('');
          setHasMore(false);
        }
      } finally {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [dataSource]
  );

  useEffect(() => {
    void loadConversations('', false);
  }, [loadConversations]);

  return (
    <div className={styles.pageContainer}>
      <Text element="h2">Conversations</Text>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Conversation query failed">
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.listContainer}>
        <ConversationListPanel
          conversations={conversations}
          selectedConversationId=""
          loading={loading}
          hasMore={hasMore && nextCursor.length > 0}
          loadingMore={loadingMore}
          onSelectConversation={(conversationID) => navigate(`/${buildConversationDetailRoute(conversationID)}`)}
          onLoadMore={() => void loadConversations(nextCursor, true)}
        />
      </div>
    </div>
  );
}
