import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Text, useStyles2 } from '@grafana/ui';
import { useNavigate } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationSearchResult } from '../conversation/types';
import { buildConversationDetailRoute } from '../constants';
import ConversationListPanel from '../components/conversations/ConversationListPanel';

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(2),
    minHeight: 0,
  }),
  titleContainer: css({
    padding: theme.spacing(3, 2, 0, 2),
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
  const [errorMessage, setErrorMessage] = useState<string>('');

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
      } catch (error) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversations');
        setConversations([]);
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

  return (
    <div className={styles.pageContainer}>
      <div className={styles.titleContainer}>
        <Text element="h2">Conversations</Text>
      </div>

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Conversation query failed">
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      {(errorMessage.length === 0 || conversations.length > 0) && (
        <div className={styles.listContainer}>
          <ConversationListPanel
            conversations={conversations}
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
