import React, { useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

export type TokenCostMode = 'tokens' | 'usd';

const DEFAULT_STORAGE_KEY = 'sigil.tokenCostBox.mode';
const numberFormatter = new Intl.NumberFormat('en-US');

function formatCost(usd: number): string {
  const absValue = Math.abs(usd);
  if (absValue < 0.01) {
    return `$${usd.toFixed(6)}`;
  }
  if (absValue < 1) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

function readInitialMode(storageKey: string): TokenCostMode {
  if (typeof window === 'undefined') {
    return 'tokens';
  }
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === 'usd' ? 'usd' : 'tokens';
  } catch {
    return 'tokens';
  }
}

export type TokenCostBoxProps = {
  tokenCount: number;
  costUSD: number;
  storageKey?: string;
  className?: string;
  ariaLabel?: string;
};

export default function TokenCostBox({
  tokenCount,
  costUSD,
  storageKey = DEFAULT_STORAGE_KEY,
  className,
  ariaLabel = 'Token cost display mode',
}: TokenCostBoxProps) {
  const styles = useStyles2(getStyles);
  const [mode, setMode] = useState<TokenCostMode>(() => readInitialMode(storageKey));

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, mode);
    } catch {
      // Ignore storage write errors in restricted environments.
    }
  }, [mode, storageKey]);

  const tokenLabel = useMemo(() => `${numberFormatter.format(tokenCount)} tokens`, [tokenCount]);
  const costLabel = useMemo(() => formatCost(costUSD), [costUSD]);

  return (
    <span className={className}>
      <select
        aria-label={ariaLabel}
        value={mode}
        onChange={(event) => setMode(event.currentTarget.value as TokenCostMode)}
        className={styles.select}
      >
        <option value="tokens">{tokenLabel}</option>
        <option value="usd">{costLabel}</option>
      </select>
    </span>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    select: css({
      display: 'inline-block',
      boxSizing: 'border-box',
      minHeight: 28,
      height: 28,
      background: 'transparent',
      color: theme.colors.text.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      padding: `0 ${theme.spacing(0.5)}`,
      fontSize: theme.typography.bodySmall.fontSize,
      fontVariantNumeric: 'tabular-nums',
      lineHeight: '24px',
      cursor: 'pointer',
      maxWidth: '100%',
      appearance: 'auto',
    }),
  };
}
