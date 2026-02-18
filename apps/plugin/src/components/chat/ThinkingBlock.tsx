import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Stack, Text, useStyles2 } from '@grafana/ui';

export type ThinkingBlockProps = {
  content: string;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    borderLeft: `3px solid ${theme.colors.border.medium}`,
    borderRadius: '0 4px 4px 0',
    overflow: 'hidden',
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
    cursor: 'pointer',
    userSelect: 'none' as const,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  content: css({
    padding: theme.spacing(1, 1.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: '300px',
    overflowY: 'auto' as const,
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
});

export default function ThinkingBlock({ content }: ThinkingBlockProps) {
  const styles = useStyles2(getStyles);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={styles.container}>
      <div
        className={styles.header}
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        aria-expanded={isOpen}
        aria-label="toggle thinking"
      >
        <Stack direction="row" gap={1} alignItems="center">
          <Icon name="eye" size="sm" />
          <Text color="secondary" italic>
            Thinking...
          </Text>
          <Icon name={isOpen ? 'angle-up' : 'angle-down'} size="sm" />
        </Stack>
      </div>
      {isOpen && <div className={styles.content}>{content}</div>}
    </div>
  );
}
