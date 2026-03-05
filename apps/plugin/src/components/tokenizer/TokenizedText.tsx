import React, { useMemo } from 'react';
import { useStyles2 } from '@grafana/ui';
import { tokenColor } from './palette';
import { getStyles } from './TokenizedText.styles';

const MAX_TOKENS = 10_000;

type TokenSegment = {
  text: string;
  id: number;
  index: number;
};

function tokenize(text: string, encode: (t: string) => number[], decode: (ids: number[]) => string): TokenSegment[] {
  const tokenIds = encode(text);
  const capped = tokenIds.length > MAX_TOKENS ? tokenIds.slice(0, MAX_TOKENS) : tokenIds;
  return capped.map((id, index) => ({
    text: decode([id]),
    id,
    index,
  }));
}

export type TokenizedTextProps = {
  text: string;
  encode: ((t: string) => number[]) | undefined;
  decode: ((ids: number[]) => string) | undefined;
};

export function TokenizedText({ text, encode, decode }: TokenizedTextProps) {
  const styles = useStyles2(getStyles);

  const { segments, truncated } = useMemo(() => {
    if (!encode || !decode) {
      return { segments: null, truncated: false };
    }
    const tokenIds = encode(text);
    const isTruncated = tokenIds.length > MAX_TOKENS;
    return { segments: tokenize(text, encode, decode), truncated: isTruncated };
  }, [text, encode, decode]);

  if (!segments) {
    return <span className={styles.container}>{text}</span>;
  }

  return (
    <span className={styles.container}>
      {segments.map((seg) => {
        const bg = `color-mix(in oklch, ${tokenColor(seg.index)}, transparent ${styles.transparencyPct}%)`;
        return (
          <span
            key={seg.index}
            className={styles.token}
            data-token-id={seg.id}
            title={`Token ID: ${seg.id}`}
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
    </span>
  );
}
