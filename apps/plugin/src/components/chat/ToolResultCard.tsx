import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Icon, Stack, Text, useStyles2 } from '@grafana/ui';
import type { ToolResultPart } from '../../conversation/types';
import { formatJson } from '../../conversation/messageParser';

export type ToolResultCardProps = {
  toolResult: ToolResultPart;
};

const MAX_COLLAPSED_LINES = 10;

const getStyles = (theme: GrafanaTheme2) => ({
  card: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: '8px',
    overflow: 'hidden',
    background: theme.colors.background.primary,
  }),
  cardError: css({
    border: `1px solid ${theme.colors.error.border}`,
    background: theme.colors.error.transparent,
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
    background: theme.colors.background.secondary,
  }),
  headerError: css({
    background: theme.colors.error.transparent,
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
  toggle: css({
    cursor: 'pointer',
    color: theme.colors.text.link,
    fontSize: theme.typography.bodySmall.fontSize,
    padding: theme.spacing(0.5, 1.5),
    '&:hover': {
      textDecoration: 'underline',
    },
  }),
});

export default function ToolResultCard({ toolResult }: ToolResultCardProps) {
  const styles = useStyles2(getStyles);
  const isError = toolResult.is_error === true;
  const [isExpanded, setIsExpanded] = useState(false);

  let displayContent = '';
  if (toolResult.content_json != null && toolResult.content_json.length > 0) {
    displayContent = formatJson(toolResult.content_json);
  } else if (toolResult.content != null) {
    displayContent = toolResult.content;
  }

  const lines = displayContent.split('\n');
  const isLong = lines.length > MAX_COLLAPSED_LINES;
  const visibleContent =
    isLong && !isExpanded ? lines.slice(0, MAX_COLLAPSED_LINES).join('\n') + '\n...' : displayContent;

  return (
    <div className={cx(styles.card, isError && styles.cardError)}>
      <div className={cx(styles.header, isError && styles.headerError)}>
        <Stack direction="row" gap={1} alignItems="center">
          <Icon name={isError ? 'exclamation-triangle' : 'check-circle'} size="sm" />
          <Badge text={toolResult.name} color={isError ? 'red' : 'green'} />
          <Text color="secondary">{toolResult.tool_call_id}</Text>
        </Stack>
      </div>
      {displayContent.length > 0 && (
        <>
          <div className={styles.body}>{visibleContent}</div>
          {isLong && (
            <div className={styles.toggle} onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? 'Show less' : `Show all (${lines.length} lines)`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
