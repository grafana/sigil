import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Text, Tooltip, useStyles2 } from '@grafana/ui';
import { inferProviderFromModelName } from '../../modelcard/resolve';
import type { ModelCard } from '../../modelcard/types';
import {
  getProviderColor,
  getProviderMeta,
  stripProviderPrefix,
  toDisplayProvider,
} from '../conversations/providerMeta';

export type ModelChipListProps = {
  models: string[];
  modelCards?: Map<string, ModelCard>;
  maxVisible?: number;
};

const BEDROCK_REGIONAL_PREFIXES = new Set(['us', 'eu', 'apac', 'jp', 'global']);
const KNOWN_BEDROCK_VENDORS = new Set(['anthropic', 'amazon', 'cohere', 'meta', 'mistral', 'ai21', 'stability']);

/**
 * Strips trailing hyphens, colon-suffixed version tags, and YYYYMMDD date
 * suffixes that Bedrock appends to model identifiers, then title-cases the
 * result so "claude-haiku-4-5" becomes "Claude Haiku 4.5".
 */
function cleanModelSuffix(name: string): string {
  const stripped = name.replace(/[:-]\d{8,}.*$/, '').replace(/-+$/, '');
  return stripped
    .split('-')
    .map((part) => (/^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
    .replace(/(\d)\s+(\d)/g, '$1.$2');
}

/**
 * For Bedrock model IDs like "us.anthropic.claude-haiku-4-5-20241022v1:0",
 * extracts the vendor (for color) and the model portion (for display name).
 */
function parseBedrockModelID(model: string): { vendor: string; modelName: string } | null {
  const parts = model.trim().toLowerCase().split('.');
  if (parts.length < 2) {
    return null;
  }
  let vendorIdx = 0;
  if (parts.length >= 3 && BEDROCK_REGIONAL_PREFIXES.has(parts[0])) {
    vendorIdx = 1;
  }
  if (vendorIdx + 1 >= parts.length || !KNOWN_BEDROCK_VENDORS.has(parts[vendorIdx])) {
    return null;
  }
  const rawName = parts.slice(vendorIdx + 1).join('.');
  return { vendor: parts[vendorIdx], modelName: cleanModelSuffix(rawName) };
}

function resolveModelDisplay(
  model: string,
  modelCards?: Map<string, ModelCard>
): { displayName: string; color: string } {
  const apiProvider = inferProviderFromModelName(model);

  if (modelCards && modelCards.size > 0 && apiProvider) {
    const card = modelCards.get(`${apiProvider}::${model}`);
    if (card) {
      const displayProv = toDisplayProvider(card.provider);
      const cleanName = stripProviderPrefix(card.name || card.source_model_id, getProviderMeta(displayProv).label);
      return { displayName: cleanName, color: getProviderColor(displayProv) };
    }
  }

  if (apiProvider === 'bedrock') {
    const parsed = parseBedrockModelID(model);
    if (parsed) {
      const displayProv = toDisplayProvider(parsed.vendor);
      const meta = getProviderMeta(displayProv);
      return { displayName: stripProviderPrefix(parsed.modelName, meta.label), color: meta.color };
    }
  }

  const displayProv = toDisplayProvider(apiProvider);
  const meta = getProviderMeta(displayProv);
  return { displayName: stripProviderPrefix(model, meta.label), color: getProviderColor(displayProv) };
}

export default function ModelChipList({ models, modelCards, maxVisible = 3 }: ModelChipListProps) {
  const styles = useStyles2(getStyles);

  if (models.length === 0) {
    return <Text color="secondary">-</Text>;
  }

  const visible = models.slice(0, maxVisible);
  const overflow = models.length - maxVisible;

  return (
    <div className={styles.list}>
      {visible.map((model) => {
        const { displayName, color } = resolveModelDisplay(model, modelCards);
        return (
          <Tooltip key={model} content={model}>
            <span className={styles.chip}>
              <span className={styles.dot} style={{ background: color }} />
              {displayName}
            </span>
          </Tooltip>
        );
      })}
      {overflow > 0 && (
        <Tooltip content={models.slice(maxVisible).join(', ')}>
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
    padding: theme.spacing(0.5, 1),
    borderRadius: '12px',
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1,
    whiteSpace: 'nowrap' as const,
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  dot: css({
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
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
