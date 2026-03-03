import React, { useCallback, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, IconButton, useStyles2 } from '@grafana/ui';
import type { ModelCard } from '../../modelcard/types';

export type ModelCardPopoverProps = {
  card: ModelCard;
  onClose: () => void;
};

type ProviderMeta = {
  label: string;
  color: string;
};

const PROVIDER_META: Record<string, ProviderMeta> = {
  openai: { label: 'OpenAI', color: '#10a37f' },
  anthropic: { label: 'Anthropic', color: '#d97757' },
  google: { label: 'Google', color: '#4285f4' },
  gemini: { label: 'Google', color: '#4285f4' },
  meta: { label: 'Meta', color: '#0668E1' },
  mistral: { label: 'Mistral', color: '#F54E42' },
  cohere: { label: 'Cohere', color: '#39594D' },
  deepseek: { label: 'DeepSeek', color: '#4D6BFE' },
};

function getProviderMeta(provider: string): ProviderMeta {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_META[normalized] ?? { label: provider || 'Unknown', color: '#888888' };
}

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
    return '-';
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
    return `https://openrouter.ai/models/${encodeURIComponent(card.source_model_id)}`;
  }
  return null;
}

const getStyles = (theme: GrafanaTheme2) => ({
  backdrop: css({
    position: 'fixed',
    inset: 0,
    zIndex: theme.zIndex.modal,
  }),
  card: css({
    position: 'absolute',
    zIndex: theme.zIndex.modal + 1,
    top: '100%',
    left: 0,
    marginTop: theme.spacing(0.5),
    width: 360,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
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
  closeButton: css({
    flexShrink: 0,
    marginTop: -4,
    marginRight: -4,
  }),
  description: css({
    padding: theme.spacing(0, 2, 1),
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
    padding: theme.spacing(0, 2, 1.5),
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
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 1,
    margin: theme.spacing(0, 2, 1.5),
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),
  specCell: css({
    background: theme.colors.background.secondary,
    padding: theme.spacing(1, 1.25),
    textAlign: 'center' as const,
  }),
  specLabel: css({
    color: theme.colors.text.secondary,
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 2,
  }),
  specValue: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  section: css({
    padding: theme.spacing(0, 2, 1.5),
  }),
  sectionTitle: css({
    color: theme.colors.text.secondary,
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: theme.spacing(0.75),
  }),
  pricingGrid: css({
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: theme.spacing(0.25, 1.5),
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  pricingLabel: css({
    color: theme.colors.text.secondary,
  }),
  pricingValue: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    textAlign: 'right' as const,
  }),
  footer: css({
    borderTop: `1px solid ${theme.colors.border.weak}`,
    padding: theme.spacing(1.25, 2),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
  }),
  sourceLink: css({
    color: theme.colors.text.link,
    fontSize: theme.typography.bodySmall.fontSize,
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    '&:hover': {
      textDecoration: 'underline',
    },
  }),
  badgeRow: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    flexWrap: 'wrap' as const,
  }),
});

export default function ModelCardPopover({ card, onClose }: ModelCardPopoverProps) {
  const styles = useStyles2(getStyles);
  const cardRef = useRef<HTMLDivElement>(null);
  const meta = getProviderMeta(card.provider);
  const sourceURL = buildSourceURL(card);
  const pricing = card.pricing;

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => { document.removeEventListener('keydown', handleEscape); };
  }, [onClose]);

  const hasPricing =
    pricing.prompt_usd_per_token != null ||
    pricing.completion_usd_per_token != null ||
    pricing.input_cache_read_usd_per_token != null ||
    pricing.input_cache_write_usd_per_token != null;

  const inputMods = card.input_modalities ?? [];
  const outputMods = card.output_modalities ?? [];
  const hasModalities = inputMods.length > 0 || outputMods.length > 0;

  const displayName = card.name || card.source_model_id;
  const cleanName = displayName.replace(new RegExp(`^${meta.label}:\\s*`, 'i'), '');

  return (
    <>
      <div className={styles.backdrop} onClick={handleBackdropClick} />
      <div className={styles.card} ref={cardRef}>
        <div className={styles.header}>
          <div
            className={styles.providerIcon}
            style={{ background: meta.color }}
          >
            {meta.label.charAt(0).toUpperCase()}
          </div>
          <div className={styles.headerText}>
            <div className={styles.providerName}>{meta.label}</div>
            <div className={styles.modelName}>{cleanName}</div>
          </div>
          <IconButton
            name="times"
            size="lg"
            aria-label="close model card"
            onClick={onClose}
            className={styles.closeButton}
          />
        </div>

        {card.description && (
          <div className={styles.description}>{card.description}</div>
        )}

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

        <div className={styles.specsRow}>
          <div className={styles.specCell}>
            <div className={styles.specLabel}>Context window</div>
            <div className={styles.specValue}>
              {formatContextLength(card.context_length ?? card.top_provider?.context_length)}
            </div>
          </div>
          <div className={styles.specCell}>
            <div className={styles.specLabel}>Max output</div>
            <div className={styles.specValue}>
              {formatContextLength(card.top_provider?.max_completion_tokens)}
            </div>
          </div>
        </div>

        {hasPricing && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Pricing (per 1M tokens)</div>
            <div className={styles.pricingGrid}>
              <span className={styles.pricingLabel}>Input</span>
              <span className={styles.pricingValue}>{formatPricePer1M(pricing.prompt_usd_per_token)}</span>
              <span className={styles.pricingLabel}>Output</span>
              <span className={styles.pricingValue}>{formatPricePer1M(pricing.completion_usd_per_token)}</span>
              {pricing.input_cache_read_usd_per_token != null && pricing.input_cache_read_usd_per_token > 0 && (
                <>
                  <span className={styles.pricingLabel}>Cache read</span>
                  <span className={styles.pricingValue}>{formatPricePer1M(pricing.input_cache_read_usd_per_token)}</span>
                </>
              )}
              {pricing.input_cache_write_usd_per_token != null && pricing.input_cache_write_usd_per_token > 0 && (
                <>
                  <span className={styles.pricingLabel}>Cache write</span>
                  <span className={styles.pricingValue}>{formatPricePer1M(pricing.input_cache_write_usd_per_token)}</span>
                </>
              )}
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <div className={styles.badgeRow}>
            {card.is_free && <Badge text="Free" color="green" />}
          </div>
          {sourceURL && (
            <a
              href={sourceURL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.sourceLink}
            >
              View on OpenRouter &rarr;
            </a>
          )}
        </div>
      </div>
    </>
  );
}
