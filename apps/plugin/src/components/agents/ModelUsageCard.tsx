import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Text, useStyles2 } from '@grafana/ui';
import type { AgentModelUsage } from '../../agents/types';
import type { ModelCard } from '../../modelcard/types';
import ModelCardContent from '../conversations/ModelCardContent';
import { getProviderMeta, stripProviderPrefix } from '../conversations/providerMeta';

export type ModelUsageCardProps = {
  model: AgentModelUsage;
  card?: ModelCard | null;
};

const getFallbackStyles = (theme: GrafanaTheme2) => ({
  card: css({
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),
  header: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    padding: theme.spacing(2, 2, 1.5),
  }),
  providerIcon: css({
    width: 40,
    height: 40,
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
    letterSpacing: '-0.02em',
  }),
  headerText: css({
    flex: 1,
    minWidth: 0,
  }),
  providerName: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: 2,
  }),
  modelName: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.3,
    overflowWrap: 'anywhere' as const,
  }),
  footer: css({
    borderTop: `1px solid ${theme.colors.border.weak}`,
    padding: theme.spacing(1.25, 2),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  }),
  badgeRow: css({
    display: 'flex',
    gap: theme.spacing(0.5),
  }),
});

function formatDateShort(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return 'n/a';
  }
  return parsed.toLocaleDateString();
}

function ModelUsageFallback({ model }: { model: AgentModelUsage }) {
  const styles = useStyles2(getFallbackStyles);
  const meta = getProviderMeta(model.provider);
  const cleanName = stripProviderPrefix(model.name, meta.label);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.providerIcon} style={{ background: meta.color }}>
          {meta.label.charAt(0).toUpperCase()}
        </div>
        <div className={styles.headerText}>
          <div className={styles.providerName}>{meta.label}</div>
          <div className={styles.modelName}>{cleanName}</div>
        </div>
      </div>
      <div className={styles.footer}>
        <div className={styles.badgeRow}>
          <Badge text={`${model.generation_count.toLocaleString()} gen`} color="purple" />
        </div>
        <Text variant="bodySmall" color="secondary">
          Last seen {formatDateShort(model.last_seen_at)}
        </Text>
      </div>
    </div>
  );
}

export default function ModelUsageCard({ model, card }: ModelUsageCardProps) {
  if (card) {
    return (
      <ModelCardContent
        card={card}
        generationCount={model.generation_count}
        lastSeenAt={model.last_seen_at}
      />
    );
  }
  return <ModelUsageFallback model={model} />;
}
