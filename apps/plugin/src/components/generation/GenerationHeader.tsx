import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Icon, LinkButton, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import type { GenerationDetail } from '../../conversation/types';

export type GenerationHeaderProps = {
  generation: GenerationDetail;
};

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
    background: theme.colors.background.secondary,
    borderRadius: '8px',
  }),
  tokenText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontFamily: theme.typography.fontFamilyMonospace,
    color: theme.colors.text.secondary,
  }),
  separator: css({
    width: '1px',
    height: '16px',
    background: theme.colors.border.medium,
  }),
});

export default function GenerationHeader({ generation }: GenerationHeaderProps) {
  const styles = useStyles2(getStyles);

  const modelLabel =
    generation.model?.provider && generation.model?.name
      ? `${generation.model.provider}/${generation.model.name}`
      : (generation.model?.name ?? 'unknown');

  const traceId = typeof generation.trace_id === 'string' ? generation.trace_id : '';
  const usage = generation.usage;

  const usageTooltip =
    usage != null
      ? Object.entries(usage)
          .filter(([, v]) => v != null && v > 0)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      : '';

  return (
    <div className={styles.container}>
      <Badge text={modelLabel} color="blue" />

      {generation.agent_name && <Badge text={generation.agent_name} color="purple" />}

      {generation.mode && <Badge text={generation.mode} color="orange" />}

      <div className={styles.separator} />

      {usage != null && (usage.input_tokens != null || usage.output_tokens != null) && (
        <Tooltip content={usageTooltip} placement="bottom">
          <Stack direction="row" gap={0.5} alignItems="center">
            <Icon name="dashboard" size="sm" />
            <span className={styles.tokenText}>
              {usage.input_tokens ?? 0} in / {usage.output_tokens ?? 0} out
            </span>
          </Stack>
        </Tooltip>
      )}

      {traceId.length > 0 && (
        <LinkButton
          variant="secondary"
          size="sm"
          icon="external-link-alt"
          href={`/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/api/v2/traces/${encodeURIComponent(traceId)}`}
          target="_blank"
          rel="noreferrer"
          aria-label="view trace"
        >
          Trace
        </LinkButton>
      )}

      {generation.created_at && (
        <Tooltip content={new Date(generation.created_at).toLocaleString()} placement="bottom">
          <Text color="secondary">{formatRelativeTime(generation.created_at)}</Text>
        </Tooltip>
      )}
    </div>
  );
}
