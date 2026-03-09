import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

type TokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'ws';

interface Token {
  type: TokenType;
  text: string;
}

const DEFAULT_COLLAPSED_LINES = 20;

/**
 * Regex-based tokenizer for pretty-printed JSON.
 * Keys are distinguished from string values by the trailing colon.
 */
function tokenize(json: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /("(?:[^"\\]|\\.)*")\s*(:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],])|(\s+)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(json)) !== null) {
    if (m.index > last) {
      tokens.push({ type: 'ws', text: json.slice(last, m.index) });
    }

    if (m[1] !== undefined) {
      tokens.push({ type: 'key', text: m[1] });
      tokens.push({ type: 'punct', text: m[2] });
    } else if (m[3] !== undefined) {
      tokens.push({ type: 'string', text: m[3] });
    } else if (m[4] !== undefined) {
      tokens.push({ type: 'number', text: m[4] });
    } else if (m[5] !== undefined) {
      tokens.push({ type: 'boolean', text: m[5] });
    } else if (m[6] !== undefined) {
      tokens.push({ type: 'null', text: m[6] });
    } else if (m[7] !== undefined) {
      tokens.push({ type: 'punct', text: m[7] });
    } else if (m[8] !== undefined) {
      tokens.push({ type: 'ws', text: m[8] });
    }

    last = re.lastIndex;
  }

  if (last < json.length) {
    tokens.push({ type: 'ws', text: json.slice(last) });
  }

  return tokens;
}

function tokenClassName(styles: ReturnType<typeof getStyles>, type: TokenType): string | undefined {
  switch (type) {
    case 'key':
      return styles.key;
    case 'string':
      return styles.string;
    case 'number':
      return styles.number;
    case 'boolean':
      return styles.boolean;
    case 'null':
      return styles.nullVal;
    case 'punct':
      return styles.punct;
    default:
      return undefined;
  }
}

export type HighlightedJsonProps = {
  content: string;
  maxCollapsedLines?: number;
};

export function HighlightedJson({ content, maxCollapsedLines = DEFAULT_COLLAPSED_LINES }: HighlightedJsonProps) {
  const styles = useStyles2(getStyles);
  const [expanded, setExpanded] = useState(false);

  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const isLong = lineCount > maxCollapsedLines;

  const displayContent = useMemo(() => {
    if (!isLong || expanded) {
      return content;
    }
    return content.split('\n').slice(0, maxCollapsedLines).join('\n');
  }, [content, isLong, expanded, maxCollapsedLines]);

  const tokens = useMemo(() => tokenize(displayContent), [displayContent]);

  return (
    <div className={styles.wrapper}>
      <pre className={styles.pre}>
        {tokens.map((tok, i) => {
          const cls = tokenClassName(styles, tok.type);
          return cls ? (
            <span key={i} className={cls}>
              {tok.text}
            </span>
          ) : (
            <span key={i}>{tok.text}</span>
          );
        })}
        {isLong && !expanded && <span className={styles.ellipsis}>{'\n\u2026'}</span>}
      </pre>
      {isLong && (
        <button type="button" className={styles.toggle} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : `Show all (${lineCount} lines)`}
        </button>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    display: 'flex',
    flexDirection: 'column' as const,
  }),
  pre: css({
    margin: 0,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: 11,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: 600,
    overflowY: 'auto' as const,
  }),
  key: css({
    color: theme.isDark ? 'oklch(0.78 0.12 220)' : 'oklch(0.45 0.15 220)',
  }),
  string: css({
    color: theme.isDark ? 'oklch(0.75 0.10 145)' : 'oklch(0.40 0.15 145)',
  }),
  number: css({
    color: theme.isDark ? 'oklch(0.80 0.14 65)' : 'oklch(0.50 0.18 65)',
  }),
  boolean: css({
    color: theme.isDark ? 'oklch(0.78 0.12 300)' : 'oklch(0.45 0.15 300)',
  }),
  nullVal: css({
    color: theme.colors.text.disabled,
    fontStyle: 'italic',
  }),
  punct: css({
    color: theme.colors.text.disabled,
  }),
  toggle: css({
    appearance: 'none',
    cursor: 'pointer',
    color: theme.colors.text.link,
    fontSize: 11,
    padding: `${theme.spacing(0.5)} 0`,
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    fontFamily: theme.typography.fontFamilyMonospace,
    '&:hover': {
      textDecoration: 'underline',
    },
  }),
  ellipsis: css({
    color: theme.colors.text.disabled,
  }),
});
