import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Icon, Select, Spinner, Toggletip, useStyles2 } from '@grafana/ui';
import type { DashboardDataSource } from '../../dashboard/api';
import type { ModelResolvePair } from '../../dashboard/types';
import type { ModelCard } from '../../modelcard/types';
import { defaultModelCardClient } from '../../modelcard/api';
import { getProviderMeta, stripProviderPrefix } from '../conversations/providerMeta';

export type ModelInfoToggleProps = {
  pairs: ModelResolvePair[];
  dataSource: DashboardDataSource;
};

function formatPricePer1M(perToken: number | null): string {
  if (perToken == null || perToken === 0) {
    return 'Free';
  }
  const per1M = perToken * 1_000_000;
  if (per1M < 0.01) {
    return `$${per1M.toFixed(4)}`;
  }
  return `$${per1M.toFixed(2)}`;
}

function formatContextLength(length: number | null | undefined): string {
  if (length == null || length === 0) {
    return '—';
  }
  if (length >= 1_000_000) {
    return `${(length / 1_000_000).toFixed(1)}M`;
  }
  if (length >= 1_000) {
    return `${Math.round(length / 1_000)}k`;
  }
  return length.toLocaleString();
}

function buildSourceURL(card: ModelCard): string | null {
  if (card.source === 'openrouter' && card.source_model_id) {
    return new URL(`/models/${card.source_model_id}`, 'https://openrouter.ai').toString();
  }
  return null;
}

export function ModelInfoToggle({ pairs, dataSource }: ModelInfoToggleProps) {
  const triggerStyles = useStyles2(getTriggerStyles);
  const hasPairs = pairs.length > 0;

  const trigger = (
    <button type="button" className={hasPairs ? triggerStyles.trigger : triggerStyles.triggerDisabled}>
      <span className={triggerStyles.label}>Models</span>
      <span className={triggerStyles.icon}>
        <Icon name="list-ul" size="lg" />
      </span>
    </button>
  );

  if (!hasPairs) {
    return trigger;
  }

  return (
    <Toggletip placement="bottom-start" fitContent content={<ModelInfoContent pairs={pairs} dataSource={dataSource} />}>
      {trigger}
    </Toggletip>
  );
}

function getTriggerStyles(theme: GrafanaTheme2) {
  const base = {
    all: 'unset' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  };
  return {
    trigger: css({
      ...base,
      cursor: 'pointer',
      '&:hover > span:last-child': {
        color: theme.colors.text.primary,
      },
    }),
    triggerDisabled: css({
      ...base,
      cursor: 'default',
      opacity: 0.4,
      pointerEvents: 'none' as const,
    }),
    label: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.2,
    }),
    icon: css({
      display: 'flex',
      alignItems: 'center',
      color: theme.colors.text.secondary,
      lineHeight: 1.2,
      transition: 'color 0.15s ease',
    }),
  };
}

type ModelInfoContentProps = {
  pairs: ModelResolvePair[];
  dataSource: DashboardDataSource;
};

type SelectOption = {
  label: string;
  value: string;
};

function ModelInfoContent({ pairs, dataSource }: ModelInfoContentProps) {
  const styles = useStyles2(getStyles);

  const options = useMemo<SelectOption[]>(() => {
    const seen = new Set<string>();
    const result: SelectOption[] = [];
    for (const p of pairs) {
      const key = `${p.provider}::${p.model}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({
        label: `${p.provider} / ${p.model}`,
        value: key,
      });
    }
    return result;
  }, [pairs]);

  const initialValue = options[0]?.value ?? '';
  const [selectedValue, setSelectedValue] = useState<string>(initialValue);
  const [card, setCard] = useState<ModelCard | null>(null);
  const [loading, setLoading] = useState(!!initialValue);
  const [error, setError] = useState('');

  const selectedPair = useMemo((): ModelResolvePair | null => {
    if (!selectedValue) {
      return null;
    }
    const [provider, ...modelParts] = selectedValue.split('::');
    const model = modelParts.join('::');
    if (!provider || !model) {
      return null;
    }
    return { provider, model };
  }, [selectedValue]);

  useEffect(() => {
    if (!selectedPair) {
      return;
    }

    let cancelled = false;

    dataSource
      .resolveModelCards([selectedPair])
      .then((response) => {
        const item = response.resolved?.[0];
        if (cancelled) {
          return null;
        }
        if (!item || item.status !== 'resolved' || !item.card) {
          setError(item?.reason === 'not_found' ? 'Model not found in catalog' : 'Could not resolve model');
          return null;
        }
        return defaultModelCardClient.lookup({ modelKey: item.card.model_key });
      })
      .then((resp) => {
        if (!cancelled && resp) {
          setCard(resp.data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load model card');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPair, dataSource]);

  return (
    <div className={styles.content}>
      <Select
        options={options}
        value={selectedValue}
        onChange={(v) => {
          const val = v?.value ?? '';
          setSelectedValue(val);
          setCard(null);
          setError('');
          if (val) {
            setLoading(true);
          }
        }}
        width={36}
      />

      {loading && (
        <div className={styles.center}>
          <Spinner />
        </div>
      )}

      {!loading && error && <div className={styles.errorText}>{error}</div>}

      {!loading && card && <ModelCardDetail card={card} />}
    </div>
  );
}

function ModelCardDetail({ card }: { card: ModelCard }) {
  const styles = useStyles2(getStyles);
  const providerMeta = getProviderMeta(card.provider);
  const sourceURL = buildSourceURL(card);
  const pricing = card.pricing;
  const displayName = card.name || card.source_model_id;
  const cleanName = stripProviderPrefix(displayName, providerMeta.label);

  const hasPricing =
    pricing.prompt_usd_per_token != null ||
    pricing.completion_usd_per_token != null ||
    pricing.input_cache_read_usd_per_token != null ||
    pricing.input_cache_write_usd_per_token != null;

  const inputMods = card.input_modalities ?? [];
  const outputMods = card.output_modalities ?? [];
  const hasModalities = inputMods.length > 0 || outputMods.length > 0;

  return (
    <div className={styles.card}>
      {/* Header */}
      <div className={styles.cardHeader}>
        <div className={styles.providerIcon} style={{ background: providerMeta.color }}>
          {providerMeta.label.charAt(0).toUpperCase()}
        </div>
        <div className={styles.headerText}>
          <span className={styles.providerName}>{providerMeta.label}</span>
          <span className={styles.modelName}>{cleanName}</span>
        </div>
        {card.is_free && <Badge text="Free" color="green" />}
      </div>

      {/* Description */}
      {card.description && <p className={styles.description}>{card.description}</p>}

      {/* Modalities */}
      {hasModalities && (
        <div className={styles.modalityRow}>
          {inputMods.length > 0 && (
            <span className={styles.modalityGroup}>
              <span className={styles.modalityGroupLabel}>In:</span>
              {inputMods.map((m) => (
                <Badge key={`in-${m}`} text={m} color="blue" />
              ))}
            </span>
          )}
          {outputMods.length > 0 && (
            <span className={styles.modalityGroup}>
              <span className={styles.modalityGroupLabel}>Out:</span>
              {outputMods.map((m) => (
                <Badge key={`out-${m}`} text={m} color="purple" />
              ))}
            </span>
          )}
        </div>
      )}

      {/* Specs */}
      <div className={styles.specsRow}>
        <div className={styles.specCell}>
          <span className={styles.specLabel}>Context</span>
          <span className={styles.specValue}>
            {formatContextLength(card.context_length ?? card.top_provider?.context_length)}
          </span>
        </div>
        <div className={styles.specCell}>
          <span className={styles.specLabel}>Max output</span>
          <span className={styles.specValue}>{formatContextLength(card.top_provider?.max_completion_tokens)}</span>
        </div>
      </div>

      {/* Pricing */}
      {hasPricing && (
        <div className={styles.pricingBlock}>
          <span className={styles.pricingTitle}>Pricing (per 1M tokens)</span>
          <div className={styles.pricingRows}>
            <div className={styles.pricingRow}>
              <span className={styles.pricingLabel}>Input</span>
              <span className={styles.pricingValue}>{formatPricePer1M(pricing.prompt_usd_per_token)}</span>
            </div>
            <div className={styles.pricingRow}>
              <span className={styles.pricingLabel}>Output</span>
              <span className={styles.pricingValue}>{formatPricePer1M(pricing.completion_usd_per_token)}</span>
            </div>
            {pricing.input_cache_read_usd_per_token != null && pricing.input_cache_read_usd_per_token > 0 && (
              <div className={styles.pricingRow}>
                <span className={styles.pricingLabel}>Cache read</span>
                <span className={styles.pricingValue}>{formatPricePer1M(pricing.input_cache_read_usd_per_token)}</span>
              </div>
            )}
            {pricing.input_cache_write_usd_per_token != null && pricing.input_cache_write_usd_per_token > 0 && (
              <div className={styles.pricingRow}>
                <span className={styles.pricingLabel}>Cache write</span>
                <span className={styles.pricingValue}>{formatPricePer1M(pricing.input_cache_write_usd_per_token)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Source link */}
      {sourceURL && (
        <a href={sourceURL} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
          View on OpenRouter &rarr;
        </a>
      )}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    content: css({
      width: 320,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
    }),
    center: css({
      display: 'flex',
      justifyContent: 'center',
      padding: theme.spacing(2, 0),
    }),
    errorText: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),

    card: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.25),
    }),
    cardHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.25),
    }),
    providerIcon: css({
      width: 36,
      height: 36,
      borderRadius: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '16px',
      fontWeight: 700,
      color: '#fff',
      flexShrink: 0,
      letterSpacing: '-0.02em',
    }),
    headerText: css({
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
    }),
    providerName: css({
      color: theme.colors.text.secondary,
      fontSize: '10px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
      lineHeight: 1.2,
    }),
    modelName: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      lineHeight: 1.3,
      overflowWrap: 'anywhere' as const,
      color: theme.colors.text.primary,
    }),
    description: css({
      margin: 0,
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      display: '-webkit-box',
      WebkitLineClamp: 3,
      WebkitBoxOrient: 'vertical' as const,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    modalityRow: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
      flexWrap: 'wrap' as const,
    }),
    modalityGroup: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
    modalityGroupLabel: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
    }),

    specsRow: css({
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 1,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
    }),
    specCell: css({
      background: theme.colors.background.secondary,
      padding: theme.spacing(0.75, 1),
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
    }),
    specLabel: css({
      color: theme.colors.text.secondary,
      fontSize: '10px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
    }),
    specValue: css({
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      fontFamily: theme.typography.fontFamilyMonospace,
      color: theme.colors.text.primary,
    }),

    pricingBlock: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    pricingTitle: css({
      color: theme.colors.text.secondary,
      fontSize: '10px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
    }),
    pricingRows: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.25),
    }),
    pricingRow: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    }),
    pricingLabel: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    pricingValue: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),

    sourceLink: css({
      color: theme.colors.text.link,
      fontSize: theme.typography.bodySmall.fontSize,
      textDecoration: 'none',
      '&:hover': {
        textDecoration: 'underline',
      },
    }),
  };
}
