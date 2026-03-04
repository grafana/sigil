import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Stack, useStyles2, type IconName } from '@grafana/ui';
import type { Message } from '../../conversation/types';
import { humanizeRole } from '../../conversation/messageParser';
import MessageBubble from './MessageBubble';
import ThinkingBlock from './ThinkingBlock';
import ToolCallCard from './ToolCallCard';
import ToolResultCard from './ToolResultCard';

export type ChatMessageProps = {
  message: Message;
};

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({
    display: 'flex',
    gap: theme.spacing(1.5),
    maxWidth: '100%',
  }),
  rowUser: css({
    flexDirection: 'row-reverse' as const,
  }),
  rowAssistant: css({
    flexDirection: 'row' as const,
  }),
  rowTool: css({
    flexDirection: 'row' as const,
  }),
  avatar: css({
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  }),
  avatarUser: css({
    background: theme.colors.primary.transparent,
    color: theme.colors.primary.text,
  }),
  avatarAssistant: css({
    background: theme.colors.secondary.transparent,
    color: theme.colors.secondary.text,
  }),
  avatarTool: css({
    background: theme.colors.info.transparent,
    color: theme.colors.info.text,
  }),
  content: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    minWidth: 0,
    maxWidth: '80%',
  }),
  contentTool: css({
    maxWidth: '100%',
    flex: 1,
  }),
  roleLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
});

function roleToIcon(role: Message['role']): IconName {
  switch (role) {
    case 'MESSAGE_ROLE_USER':
      return 'user';
    case 'MESSAGE_ROLE_ASSISTANT':
      return 'comment-alt';
    case 'MESSAGE_ROLE_TOOL':
      return 'wrench';
    default:
      return 'question-circle';
  }
}

function roleToBubbleRole(role: Message['role']): 'user' | 'assistant' | 'tool' {
  switch (role) {
    case 'MESSAGE_ROLE_USER':
      return 'user';
    case 'MESSAGE_ROLE_ASSISTANT':
      return 'assistant';
    case 'MESSAGE_ROLE_TOOL':
      return 'tool';
    default:
      return 'assistant';
  }
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const styles = useStyles2(getStyles);
  const role = message.role;
  const bubbleRole = roleToBubbleRole(role);

  const rowClass = `${styles.row} ${
    role === 'MESSAGE_ROLE_USER' ? styles.rowUser : role === 'MESSAGE_ROLE_TOOL' ? styles.rowTool : styles.rowAssistant
  }`;
  const avatarClass = `${styles.avatar} ${
    role === 'MESSAGE_ROLE_USER'
      ? styles.avatarUser
      : role === 'MESSAGE_ROLE_TOOL'
        ? styles.avatarTool
        : styles.avatarAssistant
  }`;
  const contentClass = `${styles.content} ${role === 'MESSAGE_ROLE_TOOL' ? styles.contentTool : ''}`;

  return (
    <div className={rowClass}>
      <div className={avatarClass}>
        <Icon name={roleToIcon(role)} size="md" />
      </div>
      <div className={contentClass}>
        <span className={styles.roleLabel}>{message.name ?? humanizeRole(role)}</span>
        <Stack direction="column" gap={1}>
          {(message.parts ?? []).map((part, i) => {
            if (part.thinking != null) {
              return <ThinkingBlock key={i} content={part.thinking} />;
            }
            if (part.tool_call != null) {
              return <ToolCallCard key={i} toolCall={part.tool_call} />;
            }
            if (part.tool_result != null) {
              return <ToolResultCard key={i} toolResult={part.tool_result} />;
            }
            if (part.text != null) {
              return <MessageBubble key={i} text={part.text} role={bubbleRole} />;
            }
            return null;
          })}
        </Stack>
      </div>
    </div>
  );
}
