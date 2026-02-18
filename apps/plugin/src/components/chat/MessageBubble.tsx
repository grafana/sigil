import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

export type MessageBubbleProps = {
  text: string;
  role: 'user' | 'assistant' | 'tool';
};

type CodeSegment = { type: 'text'; content: string } | { type: 'code'; language: string; content: string };

function splitCodeBlocks(text: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  const pattern = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', language: match[1] || '', content: match[2] });
    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: 'text', content: text }];
}

const getStyles = (theme: GrafanaTheme2) => ({
  userBubble: css({
    background: theme.colors.primary.transparent,
    border: `1px solid ${theme.colors.primary.border}`,
    borderRadius: '12px 12px 4px 12px',
    padding: theme.spacing(1.5, 2),
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    fontSize: theme.typography.body.fontSize,
    lineHeight: theme.typography.body.lineHeight,
    color: theme.colors.text.primary,
  }),
  assistantBubble: css({
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: '4px 12px 12px 12px',
    padding: theme.spacing(1.5, 2),
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    fontSize: theme.typography.body.fontSize,
    lineHeight: theme.typography.body.lineHeight,
    color: theme.colors.text.primary,
  }),
  toolBubble: css({
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: '8px',
    padding: theme.spacing(1.5, 2),
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    fontSize: theme.typography.body.fontSize,
    lineHeight: theme.typography.body.lineHeight,
    color: theme.colors.text.primary,
  }),
  codeBlock: css({
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: '4px',
    padding: theme.spacing(1, 1.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    overflowX: 'auto' as const,
    margin: theme.spacing(1, 0),
  }),
  codeLang: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(0.5),
  }),
});

export default function MessageBubble({ text, role }: MessageBubbleProps) {
  const styles = useStyles2(getStyles);
  const segments = splitCodeBlocks(text);
  const bubbleClass =
    role === 'user' ? styles.userBubble : role === 'assistant' ? styles.assistantBubble : styles.toolBubble;

  return (
    <div className={bubbleClass}>
      {segments.map((segment, i) =>
        segment.type === 'code' ? (
          <div key={i} className={styles.codeBlock}>
            {segment.language && <div className={styles.codeLang}>{segment.language}</div>}
            <pre style={{ margin: 0 }}>{segment.content}</pre>
          </div>
        ) : (
          <span key={i}>{segment.content}</span>
        )
      )}
    </div>
  );
}
