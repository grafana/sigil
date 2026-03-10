import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Text, Tooltip, useStyles2 } from '@grafana/ui';
import { buildAgentDetailHref } from '../dashboard/ViewAgentsLink';

export type AgentChipListProps = {
  agents: string[];
  maxVisible?: number;
};

export default function AgentChipList({ agents, maxVisible = 3 }: AgentChipListProps) {
  const styles = useStyles2(getStyles);

  if (agents.length === 0) {
    return <Text color="secondary">-</Text>;
  }

  const visible = agents.slice(0, maxVisible);
  const overflow = agents.length - maxVisible;

  return (
    <div className={styles.list}>
      {visible.map((agent) => (
        <a
          key={agent}
          href={buildAgentDetailHref(agent)}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.chip}
          title={`Open ${agent} agent page`}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon name="user" size="xs" />
          {agent}
        </a>
      ))}
      {overflow > 0 && (
        <Tooltip content={agents.slice(maxVisible).join(', ')}>
          <span className={styles.overflow}>+{overflow}</span>
        </Tooltip>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  list: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
    alignItems: 'center',
  }),
  chip: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.25, 1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.5,
    whiteSpace: 'nowrap' as const,
    maxWidth: 240,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  overflow: css({
    display: 'inline-flex',
    alignItems: 'center',
    padding: theme.spacing(0.25, 0.75),
    borderRadius: '12px',
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1,
    color: theme.colors.text.secondary,
  }),
});
