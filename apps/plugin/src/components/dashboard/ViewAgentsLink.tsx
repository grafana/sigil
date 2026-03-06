import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES, buildAgentDetailByNameRoute, buildAnonymousAgentDetailRoute } from '../../constants';

export function buildAgentDetailHref(name: string): string {
  const route = name.trim().length > 0 ? buildAgentDetailByNameRoute(name) : buildAnonymousAgentDetailRoute();
  return `${PLUGIN_BASE}/${route}`;
}

type ViewAgentsLinkProps = {
  agentName?: string;
};

export function ViewAgentsLink({ agentName }: ViewAgentsLinkProps) {
  const styles = useStyles2(getStyles);
  const href = agentName ? buildAgentDetailHref(agentName) : `${PLUGIN_BASE}/${ROUTES.Agents}`;
  const label = agentName ? `View agent: ${agentName}` : 'View agents';
  return (
    <Tooltip content={label}>
      <a href={href} className={styles.link} aria-label={label}>
        <Icon name="user" size="md" />
      </a>
    </Tooltip>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    link: css({
      color: theme.colors.text.secondary,
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      fontSize: theme.typography.bodySmall.fontSize,
      textDecoration: 'none',
      whiteSpace: 'nowrap',
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
  };
}
