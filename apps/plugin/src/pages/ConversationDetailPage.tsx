import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, LoadingPlaceholder, Stack, Text, useStyles2 } from '@grafana/ui';
import { useNavigate, useParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationDetail } from '../conversation/types';

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(2),
    minHeight: 0,
  }),
  panelContainer: css({
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  }),
  jsonBlock: css({
    margin: 0,
    padding: theme.spacing(2),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    lineHeight: theme.typography.lineHeight.md,
  }),
});

export type ConversationDetailPageProps = {
  dataSource?: ConversationsDataSource;
};

export default function ConversationDetailPage(props: ConversationDetailPageProps) {
  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const navigate = useNavigate();
  const styles = useStyles2(getStyles);
  const params = useParams<{ conversationID: string }>();
  const conversationID = decodeURIComponent(params.conversationID ?? '');

  const [conversationDetail, setConversationDetail] = useState<ConversationDetail | null>(null);
  const [loadingConversationDetail, setLoadingConversationDetail] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const conversationRequestVersion = useRef<number>(0);

  useEffect(() => {
    conversationRequestVersion.current += 1;
    const requestVersion = conversationRequestVersion.current;

    if (conversationID.length === 0) {
      setConversationDetail(null);
      return;
    }

    setLoadingConversationDetail(true);
    setErrorMessage('');

    void dataSource
      .getConversationDetail(conversationID)
      .then((detail) => {
        if (conversationRequestVersion.current !== requestVersion) {
          return;
        }
        setConversationDetail(detail);
        setSelectedGenerationID(detail.generations?.[0]?.generation_id ?? '');
      })
      .catch((error) => {
        if (conversationRequestVersion.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversation detail');
        setConversationDetail(null);
      })
      .finally(() => {
        if (conversationRequestVersion.current !== requestVersion) {
          return;
        }
        setLoadingConversationDetail(false);
      });
  }, [conversationID, dataSource]);

  return (
    <div className={styles.pageContainer}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Text element="h2">Conversation detail</Text>
        <Button variant="secondary" onClick={() => navigate('../..', { relative: 'path' })}>
          Back to conversations
        </Button>
      </Stack>

      {conversationID.length > 0 && (
        <Text color="secondary" element="div">
          {conversationID}
        </Text>
      )}

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Conversation detail failed">
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.panelContainer}>
        {loadingConversationDetail ? (
          <LoadingPlaceholder text="Loading conversation detail..." />
        ) : conversationDetail ? (
          <pre className={styles.jsonBlock}>{JSON.stringify(conversationDetail, null, 2)}</pre>
        ) : (
          <Text color="secondary">No conversation detail available.</Text>
        )}
      </div>
    </div>
  );
}
