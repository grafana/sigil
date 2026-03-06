import React from 'react';
import { cx } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GenerationDetail, Message, MessageRole, Part } from '../../generation/types';
import { getStyles } from './ChatThread.styles';
import { renderTextWithXml } from './CollapsibleXml';
import { formatToolContent } from './formatContent';

export type ChatThreadProps = {
  generations: GenerationDetail[];
};

type ThreadEntry = {
  key: string;
  kind: 'message' | 'divider';
  role?: MessageRole;
  parts?: Part[];
  dividerLabel?: string;
};

function buildThread(generations: GenerationDetail[]): ThreadEntry[] {
  const entries: ThreadEntry[] = [];

  for (let gIdx = 0; gIdx < generations.length; gIdx++) {
    const gen = generations[gIdx];

    if (gIdx > 0) {
      const model = gen.model?.name ?? '';
      const agent = gen.agent_name ?? '';
      const label = [agent, model].filter(Boolean).join(' · ') || `generation ${gIdx + 1}`;
      entries.push({ key: `div-${gen.generation_id}`, kind: 'divider', dividerLabel: label });
    }

    const allMessages: Message[] = [...(gen.input ?? []), ...(gen.output ?? [])];

    for (let mIdx = 0; mIdx < allMessages.length; mIdx++) {
      const msg = allMessages[mIdx];
      if (msg.parts.length === 0) {
        continue;
      }
      entries.push({
        key: `msg-${gen.generation_id}-${mIdx}`,
        kind: 'message',
        role: msg.role,
        parts: msg.parts,
      });
    }
  }

  return entries;
}

function partToText(part: Part): string | null {
  if (part.text) {
    return part.text;
  }
  if (part.thinking) {
    return null;
  }
  if (part.tool_call) {
    return null;
  }
  if (part.tool_result) {
    const raw = part.tool_result.content ?? part.tool_result.content_json ?? null;
    return raw ? formatToolContent(raw) : null;
  }
  return null;
}

function RoleBadge({ role, isSystem }: { role?: MessageRole; isSystem?: boolean }) {
  const styles = useStyles2(getStyles);

  if (isSystem) {
    return <div className={cx(styles.roleLabel, styles.roleLabelSystem)}>System</div>;
  }

  switch (role) {
    case 'MESSAGE_ROLE_USER':
      return <div className={cx(styles.roleLabel, styles.roleLabelUser)}>User</div>;
    case 'MESSAGE_ROLE_ASSISTANT':
      return <div className={cx(styles.roleLabel, styles.roleLabelAssistant)}>Assistant</div>;
    case 'MESSAGE_ROLE_TOOL':
      return <div className={cx(styles.roleLabel, styles.roleLabelTool)}>Tool</div>;
    default:
      return null;
  }
}

function MessageBubble({ entry }: { entry: ThreadEntry }) {
  const styles = useStyles2(getStyles);
  const isSystem = entry.role === undefined;
  const parts = entry.parts ?? [];

  const messageClass = isSystem
    ? styles.systemMessage
    : entry.role === 'MESSAGE_ROLE_USER'
      ? styles.userMessage
      : entry.role === 'MESSAGE_ROLE_TOOL'
        ? styles.toolMessage
        : styles.assistantMessage;

  return (
    <div className={cx(styles.message, messageClass)}>
      <RoleBadge role={entry.role} isSystem={isSystem} />
      {parts.map((part, i) => {
        const text = partToText(part);

        if (part.thinking) {
          return (
            <div key={i} className={styles.thinkingBlock}>
              {part.thinking.length > 500 ? `${part.thinking.slice(0, 500)}...` : part.thinking}
            </div>
          );
        }

        if (part.tool_call) {
          const formattedArgs = part.tool_call.input_json ? formatToolContent(part.tool_call.input_json) : '';
          return (
            <div key={i} className={styles.toolCallBlock}>
              <div className={styles.toolCallName}>{part.tool_call.name}</div>
              {formattedArgs && <div className={styles.toolCallArgs}>{formattedArgs}</div>}
            </div>
          );
        }

        if (text) {
          return (
            <div key={i} className={styles.messageContent}>
              {renderTextWithXml(text)}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export default function ChatThread({ generations }: ChatThreadProps) {
  const styles = useStyles2(getStyles);
  const entries = buildThread(generations);

  if (entries.length === 0) {
    return <div className={styles.emptyState}>No messages in this conversation</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>Conversation Thread</div>
      {entries.map((entry) =>
        entry.kind === 'divider' ? (
          <div key={entry.key} className={styles.generationDivider}>
            {entry.dividerLabel}
          </div>
        ) : (
          <MessageBubble key={entry.key} entry={entry} />
        )
      )}
    </div>
  );
}
