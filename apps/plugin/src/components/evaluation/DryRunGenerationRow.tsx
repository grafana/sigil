import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, Stack, Text, Tooltip, useStyles2 } from '@grafana/ui';
import type { PreviewGenerationSample } from '../../evaluation/types';

export type DryRunGenerationRowProps = {
  sample: PreviewGenerationSample;
  onAddMatchCriteria?: (key: string, value: string) => void;
};

const TRUNCATE_LEN = 24;
const PREVIEW_LEN = 80;

const BADGE_PALETTE = [
  { bg: 'rgba(88, 166, 255, 0.2)', border: 'rgba(88, 166, 255, 0.5)', text: 'rgb(120, 190, 255)' },
  { bg: 'rgba(97, 210, 162, 0.2)', border: 'rgba(97, 210, 162, 0.5)', text: 'rgb(100, 220, 180)' },
  { bg: 'rgba(245, 166, 35, 0.2)', border: 'rgba(245, 166, 35, 0.5)', text: 'rgb(255, 190, 80)' },
  { bg: 'rgba(179, 136, 255, 0.2)', border: 'rgba(179, 136, 255, 0.5)', text: 'rgb(200, 160, 255)' },
  { bg: 'rgba(0, 204, 204, 0.2)', border: 'rgba(0, 204, 204, 0.5)', text: 'rgb(0, 224, 224)' },
  { bg: 'rgba(255, 138, 128, 0.2)', border: 'rgba(255, 138, 128, 0.5)', text: 'rgb(255, 160, 150)' },
] as const;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function getBadgeColor(value: string): (typeof BADGE_PALETTE)[number] {
  return BADGE_PALETTE[hashStr(value) % BADGE_PALETTE.length];
}

function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) {
    return s;
  }
  return `${chars.slice(0, max).join('')}…`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({
    padding: theme.spacing(1, 2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  }),
  meta: css({
    color: theme.colors.text.primary,
    fontSize: theme.typography.size.xs,
  }),
  badge: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    padding: theme.spacing(0.125, 0.5),
    borderRadius: theme.shape.radius.sm,
    fontSize: theme.typography.size.xs,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  badgeClickable: css({
    cursor: 'pointer',
    transition: 'border-color 0.15s, color 0.15s',
    '&:hover': {
      borderColor: theme.colors.primary.main,
      color: theme.colors.primary.text,
    },
  }),
  preview: css({
    marginTop: theme.spacing(0.5),
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.size.sm,
    color: theme.colors.text.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  }),
});

function parseModelForMatch(model: string): Array<{ key: string; value: string }> {
  const slashIdx = model.indexOf('/');
  if (slashIdx >= 0) {
    return [
      { key: 'model.provider', value: model.slice(0, slashIdx) },
      { key: 'model.name', value: model.slice(slashIdx + 1) },
    ];
  }
  return [{ key: 'model.name', value: model }];
}

export default function DryRunGenerationRow({ sample, onAddMatchCriteria }: DryRunGenerationRowProps) {
  const styles = useStyles2(getStyles);

  const handleAgentClick = () => {
    if (sample.agent_name != null && onAddMatchCriteria != null) {
      onAddMatchCriteria('agent_name', sample.agent_name);
    }
  };

  const handleModelClick = () => {
    if (sample.model != null && onAddMatchCriteria != null) {
      for (const { key, value } of parseModelForMatch(sample.model)) {
        onAddMatchCriteria(key, value);
      }
    }
  };

  return (
    <div className={styles.row}>
      <Stack direction="column" gap={0.5}>
        <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
          <Text weight="bold" variant="bodySmall">
            {truncate(sample.generation_id, TRUNCATE_LEN)}
          </Text>
          {sample.agent_name != null &&
          (onAddMatchCriteria != null ? (
            <Tooltip content="Add as matcher" placement="top">
              <button
                type="button"
                className={`${styles.badge} ${styles.badgeClickable}`}
                onClick={handleAgentClick}
                style={{
                  background: getBadgeColor(sample.agent_name).bg,
                  border: `1px solid ${getBadgeColor(sample.agent_name).border}`,
                  color: getBadgeColor(sample.agent_name).text,
                }}
              >
                <Icon name="plus" size="xs" />
                {sample.agent_name}
              </button>
            </Tooltip>
          ) : (
            <span
              className={styles.badge}
              style={{
                background: getBadgeColor(sample.agent_name).bg,
                border: `1px solid ${getBadgeColor(sample.agent_name).border}`,
                color: getBadgeColor(sample.agent_name).text,
              }}
            >
              {sample.agent_name}
            </span>
          ))}
          {sample.model != null &&
          (onAddMatchCriteria != null ? (
            <Tooltip content="Add as matcher" placement="top">
              <button
                type="button"
                className={`${styles.badge} ${styles.badgeClickable}`}
                onClick={handleModelClick}
                style={{
                  background: getBadgeColor(sample.model).bg,
                  border: `1px solid ${getBadgeColor(sample.model).border}`,
                  color: getBadgeColor(sample.model).text,
                }}
              >
                <Icon name="plus" size="xs" />
                {sample.model}
              </button>
            </Tooltip>
          ) : (
            <span
              className={styles.badge}
              style={{
                background: getBadgeColor(sample.model).bg,
                border: `1px solid ${getBadgeColor(sample.model).border}`,
                color: getBadgeColor(sample.model).text,
              }}
            >
              {sample.model}
            </span>
          ))}
        </Stack>
        <span className={styles.meta}>{formatDate(sample.created_at)}</span>
        {sample.input_preview != null && sample.input_preview.length > 0 && (
          <div className={styles.preview} title={sample.input_preview}>
            {truncate(sample.input_preview, PREVIEW_LEN)}
          </div>
        )}
      </Stack>
    </div>
  );
}
