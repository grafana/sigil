import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Stack, Text, useStyles2 } from '@grafana/ui';
import { useNavigate, useParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type { ConversationDetail, GenerationDetail } from '../conversation/types';
import { ROUTES } from '../constants';
import GenerationViewerPanel from '../components/generation/GenerationViewerPanel';

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
    overflow: 'hidden',
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
  const [generationDetail, setGenerationDetail] = useState<GenerationDetail | null>(null);
  const [selectedGenerationID, setSelectedGenerationID] = useState<string>('');
  const [loadingConversationDetail, setLoadingConversationDetail] = useState<boolean>(false);
  const [loadingGenerationDetail, setLoadingGenerationDetail] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const conversationRequestVersion = useRef<number>(0);
  const generationRequestVersion = useRef<number>(0);

  useEffect(() => {
    conversationRequestVersion.current += 1;
    const requestVersion = conversationRequestVersion.current;

    if (conversationID.length === 0) {
      setConversationDetail(null);
      setSelectedGenerationID('');
      setGenerationDetail(null);
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
        setSelectedGenerationID('');
        setGenerationDetail(null);
      })
      .finally(() => {
        if (conversationRequestVersion.current !== requestVersion) {
          return;
        }
        setLoadingConversationDetail(false);
      });
  }, [conversationID, dataSource]);

  useEffect(() => {
    generationRequestVersion.current += 1;
    const requestVersion = generationRequestVersion.current;

    if (selectedGenerationID.length === 0) {
      setGenerationDetail(null);
      return;
    }

    setLoadingGenerationDetail(true);
    setErrorMessage('');

    void dataSource
      .getGeneration(selectedGenerationID)
      .then((detail) => {
        if (generationRequestVersion.current !== requestVersion) {
          return;
        }
        setGenerationDetail(detail);
      })
      .catch((error) => {
        if (generationRequestVersion.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load generation detail');
        setGenerationDetail(null);
      })
      .finally(() => {
        if (generationRequestVersion.current !== requestVersion) {
          return;
        }
        setLoadingGenerationDetail(false);
      });
  }, [dataSource, selectedGenerationID]);

  return (
    <div className={styles.pageContainer}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Text element="h2">Conversation detail</Text>
        <Button variant="secondary" onClick={() => navigate(`/${ROUTES.Conversations}`)}>
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
        <GenerationViewerPanel
          conversationDetail={conversationDetail}
          generationDetail={generationDetail}
          loading={loadingConversationDetail || loadingGenerationDetail}
          onSelectGeneration={setSelectedGenerationID}
        />
      </div>
    </div>
  );
}
