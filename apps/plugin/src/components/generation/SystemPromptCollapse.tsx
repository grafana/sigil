import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Stack, Text, useStyles2 } from '@grafana/ui';

export type SystemPromptCollapseProps = {
  systemPrompt: string;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: '8px',
    overflow: 'hidden',
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
  content: css({
    padding: theme.spacing(1.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: '300px',
    overflowY: 'auto' as const,
    color: theme.colors.text.secondary,
    borderTop: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
  }),
});

export default function SystemPromptCollapse({ systemPrompt }: SystemPromptCollapseProps) {
  const styles = useStyles2(getStyles);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={styles.container}>
      <div
        className={styles.header}
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        aria-expanded={isOpen}
        aria-label="toggle system prompt"
      >
        <Stack direction="row" gap={1} alignItems="center">
          <Icon name="file-alt" size="sm" />
          <Text color="secondary">System prompt</Text>
          <Icon name={isOpen ? 'angle-up' : 'angle-down'} size="sm" />
        </Stack>
      </div>
      {isOpen && <div className={styles.content}>{systemPrompt}</div>}
    </div>
  );
}
