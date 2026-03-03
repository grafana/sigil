import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import ChatMessage from '../chat/ChatMessage';
import { parseMessages } from '../../conversation/messageParser';
import type { GenerationDetail } from '../../conversation/types';

export type ChatPreviewProps = {
  generationID: string;
  input: GenerationDetail['input'];
  output: GenerationDetail['output'];
  compact?: boolean;
  borderless?: boolean;
};

const getStyles = (theme: GrafanaTheme2) => ({
  chatPanel: css({
    label: 'chatPreview-chatPanel',
    display: 'grid',
    gap: theme.spacing(0.75),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    padding: theme.spacing(1),
    maxHeight: '520px',
    overflowY: 'auto' as const,
  }),
  chatPanelCompact: css({
    label: 'chatPreview-chatPanelCompact',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.75),
    maxHeight: '220px',
  }),
  chatPanelBorderless: css({
    label: 'chatPreview-chatPanelBorderless',
    border: 'none',
    borderRadius: 0,
    background: 'transparent',
    padding: 0,
  }),
  rawFallback: css({
    label: 'chatPreview-rawFallback',
    margin: 0,
    padding: theme.spacing(1),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere' as const,
    maxHeight: '260px',
    overflowY: 'auto' as const,
  }),
  rawFallbackCompact: css({
    label: 'chatPreview-rawFallbackCompact',
    maxHeight: '120px',
    padding: theme.spacing(0.75),
  }),
});

export default function ChatPreview({ generationID, input, output, compact = false, borderless = false }: ChatPreviewProps) {
  const styles = useStyles2(getStyles);
  const inputMessages = parseMessages(input);
  const outputMessages = parseMessages(output);
  const inputRaw = input != null ? JSON.stringify(input, null, 2) : '';
  const outputRaw = output != null ? JSON.stringify(output, null, 2) : '';

  return (
    <div className={`${styles.chatPanel} ${compact ? styles.chatPanelCompact : ''} ${borderless ? styles.chatPanelBorderless : ''}`}>
      {inputMessages.length > 0 ? (
        inputMessages.map((message, messageIndex) => (
          <ChatMessage key={`${generationID}-input-${messageIndex}`} message={message} alignLeft />
        ))
      ) : (
        <pre className={`${styles.rawFallback} ${compact ? styles.rawFallbackCompact : ''}`}>
          {inputRaw.length > 0 ? inputRaw : 'No input messages'}
        </pre>
      )}
      {outputMessages.length > 0 ? (
        outputMessages.map((message, messageIndex) => (
          <ChatMessage key={`${generationID}-output-${messageIndex}`} message={message} alignLeft />
        ))
      ) : (
        <pre className={`${styles.rawFallback} ${compact ? styles.rawFallbackCompact : ''}`}>
          {outputRaw.length > 0 ? outputRaw : 'No output messages'}
        </pre>
      )}
    </div>
  );
}
