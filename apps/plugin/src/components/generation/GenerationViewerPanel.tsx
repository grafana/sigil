import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Icon, Spinner, Text, useStyles2 } from '@grafana/ui';
import type { ConversationDetail, GenerationDetail } from '../../conversation/types';
import { parseMessages } from '../../conversation/messageParser';
import GenerationStepper from './GenerationStepper';
import GenerationHeader from './GenerationHeader';
import SystemPromptCollapse from './SystemPromptCollapse';
import ChatThread from '../chat/ChatThread';

export type GenerationViewerPanelProps = {
  conversationDetail: ConversationDetail | null;
  generationDetail: GenerationDetail | null;
  loading: boolean;
  onSelectGeneration: (generationId: string) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  panel: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1.5),
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
  }),
  emptyState: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(6),
    color: theme.colors.text.secondary,
    flex: 1,
  }),
  spinnerContainer: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(6),
    flex: 1,
  }),
});

export default function GenerationViewerPanel({
  conversationDetail,
  generationDetail,
  loading,
  onSelectGeneration,
}: GenerationViewerPanelProps) {
  const styles = useStyles2(getStyles);
  const generations = useMemo(() => conversationDetail?.generations ?? [], [conversationDetail]);

  const currentIndex = useMemo(() => {
    if (!generationDetail || generations.length === 0) {
      return 0;
    }
    const idx = generations.findIndex((g) => g.generation_id === generationDetail.generation_id);
    return idx >= 0 ? idx : generations.length - 1;
  }, [generationDetail, generations]);

  const handleSelectIndex = (index: number) => {
    if (index >= 0 && index < generations.length) {
      onSelectGeneration(generations[index].generation_id);
    }
  };

  const messages = useMemo(() => {
    if (!generationDetail) {
      return [];
    }
    return [...parseMessages(generationDetail.input), ...parseMessages(generationDetail.output)];
  }, [generationDetail]);

  if (!conversationDetail) {
    return (
      <div className={styles.emptyState}>
        <Icon name="comments-alt" size="xxl" />
        <Text color="secondary">Select a conversation to view generations</Text>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.spinnerContainer}>
        <Spinner aria-label="loading generation" />
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <GenerationStepper generations={generations} currentIndex={currentIndex} onSelectIndex={handleSelectIndex} />

      {generationDetail && <GenerationHeader generation={generationDetail} />}

      {generationDetail?.system_prompt && <SystemPromptCollapse systemPrompt={generationDetail.system_prompt} />}

      <ChatThread messages={messages} />

      {generationDetail?.error != null && generationDetail.error.message && (
        <Alert severity="error" title="Generation error">
          {generationDetail.error.message}
        </Alert>
      )}
    </div>
  );
}
