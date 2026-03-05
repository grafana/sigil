import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStyles2 } from '@grafana/ui';
import { tokenColor } from './palette';
import { getStyles } from './TokenizedText.styles';

const MAX_TOKENS = 10_000;

export type TokenizedTextProps = {
  text: string;
  encode: ((t: string) => number[]) | undefined;
  decode: ((ids: number[]) => string) | undefined;
};

export function TokenizedText({ text, encode, decode }: TokenizedTextProps) {
  const styles = useStyles2(getStyles);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);

  const handleMouseOver = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const tokenId = target.dataset?.tokenId;
    if (!tokenId) {
      setTip(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    setTip({
      id: tokenId,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  const handleMouseLeave = useCallback(() => setTip(null), []);

  const { segments, truncated } = useMemo(() => {
    if (!encode || !decode) {
      return { segments: null, truncated: false };
    }
    const tokenIds = encode(text);
    const isTruncated = tokenIds.length > MAX_TOKENS;
    const capped = isTruncated ? tokenIds.slice(0, MAX_TOKENS) : tokenIds;
    return {
      segments: capped.map((id, index) => ({ text: decode([id]), id, index })),
      truncated: isTruncated,
    };
  }, [text, encode, decode]);

  if (!segments) {
    return <span className={styles.container}>{text}</span>;
  }

  return (
    <span
      className={styles.container}
      onMouseOver={handleMouseOver}
      onMouseLeave={handleMouseLeave}
    >
      {segments.map((seg) => {
        const bg = `color-mix(in oklch, ${tokenColor(seg.index)}, transparent ${styles.transparencyPct}%)`;
        return (
          <span
            key={seg.index}
            className={styles.token}
            data-token-id={seg.id}
            style={{ backgroundColor: bg }}
          >
            {seg.text}
          </span>
        );
      })}
      {truncated && (
        <span className={styles.truncated}>
          {'\u2026'} (truncated at {MAX_TOKENS.toLocaleString()} tokens)
        </span>
      )}
      {tip &&
        createPortal(
          <span className={styles.tip} style={{ left: tip.x, top: tip.y }}>
            id: {tip.id}
          </span>,
          document.body
        )}
    </span>
  );
}
