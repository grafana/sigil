import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Text, useStyles2 } from '@grafana/ui';
import type { Message } from '../../conversation/types';
import ChatMessage from './ChatMessage';

export type ChatThreadProps = {
  messages: Message[];
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
    overflowY: 'auto' as const,
    padding: theme.spacing(2),
    flex: 1,
    minHeight: 0,
  }),
  emptyState: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    color: theme.colors.text.secondary,
  }),
});

export default function ChatThread({ messages }: ChatThreadProps) {
  const styles = useStyles2(getStyles);

  if (messages.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Icon name="comment-alt" size="xl" />
        <Text color="secondary">No messages to display</Text>
      </div>
    );
  }

  return (
    <div className={styles.container} role="log" aria-label="chat messages">
      {messages.map((message, i) => (
        <ChatMessage key={i} message={message} />
      ))}
    </div>
  );
}
