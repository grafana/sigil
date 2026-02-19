import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Icon, Stack, useStyles2 } from '@grafana/ui';
import type { ToolCallPart } from '../../conversation/types';
import { formatJson } from '../../conversation/messageParser';

export type ToolCallCardProps = {
  toolCall: ToolCallPart;
};

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '8px',
    overflow: 'hidden',
    background: theme.colors.background.primary,
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
    background: theme.colors.background.secondary,
    cursor: 'pointer',
    userSelect: 'none' as const,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  body: css({
    padding: theme.spacing(1, 1.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: '400px',
    overflowY: 'auto' as const,
    color: theme.colors.text.primary,
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  callId: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
});

export default function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const styles = useStyles2(getStyles);
  const hasInput = toolCall.input_json != null && toolCall.input_json.length > 0;
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={styles.card}>
      <div
        className={styles.header}
        onClick={() => hasInput && setIsOpen(!isOpen)}
        role="button"
        aria-expanded={isOpen}
        aria-label={`tool call ${toolCall.name}`}
      >
        <Stack direction="row" gap={1} alignItems="center">
          <Icon name="wrench" size="sm" />
          <Badge text={toolCall.name} color="blue" />
          <span className={styles.callId}>{toolCall.id}</span>
          {hasInput && <Icon name={isOpen ? 'angle-up' : 'angle-down'} size="sm" />}
        </Stack>
      </div>
      {isOpen && hasInput && <div className={styles.body}>{formatJson(toolCall.input_json!)}</div>}
    </div>
  );
}
