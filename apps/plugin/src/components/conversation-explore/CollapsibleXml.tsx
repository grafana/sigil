import React, { useCallback, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Portal, useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';

type TextSegment =
  | { kind: 'text'; content: string }
  | { kind: 'xml'; tagName: string; attributes: string; content: string };

const HTML_INLINE_TAGS = new Set([
  'b',
  'i',
  'u',
  'em',
  'strong',
  'a',
  'span',
  'code',
  'br',
  'hr',
  'img',
  'sub',
  'sup',
  's',
  'small',
  'mark',
  'p',
]);

function findMatchingClose(text: string, tagName: string, searchFrom: number): number {
  const openPattern = `<${tagName}`;
  const closeTag = `</${tagName}>`;
  let depth = 1;
  let pos = searchFrom;

  while (pos < text.length) {
    const nextClose = text.indexOf(closeTag, pos);
    if (nextClose === -1) {
      return -1;
    }

    let scanPos = pos;
    while (scanPos < nextClose) {
      const nextOpen = text.indexOf(openPattern, scanPos);
      if (nextOpen === -1 || nextOpen >= nextClose) {
        break;
      }
      const charAfter = text[nextOpen + openPattern.length];
      if (charAfter === '>' || charAfter === ' ' || charAfter === '\t' || charAfter === '\n') {
        depth++;
      }
      scanPos = nextOpen + openPattern.length;
    }

    depth--;
    if (depth === 0) {
      return nextClose;
    }
    pos = nextClose + closeTag.length;
  }

  return -1;
}

export function parseXmlBlocks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const openTagRegex = /<([a-zA-Z_][\w-]*)((?:\s+[^>]*)?)>/g;
  let lastIndex = 0;

  while (lastIndex < text.length) {
    openTagRegex.lastIndex = lastIndex;
    const match = openTagRegex.exec(text);
    if (!match) {
      break;
    }

    const tagName = match[1];
    const attributes = match[2]?.trim() ?? '';

    if (HTML_INLINE_TAGS.has(tagName.toLowerCase())) {
      lastIndex = match.index + 1;
      continue;
    }

    const afterOpenTag = match.index + match[0].length;
    const closeIndex = findMatchingClose(text, tagName, afterOpenTag);

    if (closeIndex === -1) {
      lastIndex = match.index + 1;
      continue;
    }

    const innerContent = text.slice(afterOpenTag, closeIndex);
    const lineCount = innerContent.split('\n').length;
    if (lineCount < 2 && innerContent.length < 50) {
      lastIndex = match.index + 1;
      continue;
    }

    if (match.index > lastIndex) {
      segments.push({ kind: 'text', content: text.slice(lastIndex, match.index) });
    }

    segments.push({ kind: 'xml', tagName, attributes, content: innerContent });

    const closeTag = `</${tagName}>`;
    lastIndex = closeIndex + closeTag.length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', content: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ kind: 'text', content: text }];
}

function contentPreview(content: string, maxLines = 6, maxLen = 500): string {
  const lines = content.trimStart().split('\n').slice(0, maxLines);
  const preview = lines.join('\n');
  return preview.length > maxLen ? preview.slice(0, maxLen) + '\u2026' : preview;
}

function HoverPreview({ content, anchorRect }: { content: string; anchorRect: DOMRect }) {
  const styles = useStyles2(getStyles);

  return (
    <Portal>
      <div className={styles.hoverPopup} style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}>
        <pre className={styles.hoverPre}>{contentPreview(content)}</pre>
      </div>
    </Portal>
  );
}

function CollapsibleXmlBlock({
  tagName,
  attributes,
  content,
}: {
  tagName: string;
  attributes: string;
  content: string;
}) {
  const styles = useStyles2(getStyles);
  const label = attributes ? `<${tagName} ${attributes}>` : `<${tagName}>`;
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const innerSegments = parseXmlBlocks(content);

  const handleToggle = useCallback((e: React.SyntheticEvent<HTMLDetailsElement>) => {
    setOpen((e.target as HTMLDetailsElement).open);
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (!open && summaryRef.current) {
      setAnchorRect(summaryRef.current.getBoundingClientRect());
    }
  }, [open]);

  const handleMouseLeave = useCallback(() => {
    setAnchorRect(null);
  }, []);

  return (
    <details className={styles.xmlDetails} onToggle={handleToggle}>
      <summary
        ref={summaryRef}
        className={styles.xmlSummary}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span className={styles.xmlSummaryArrow}>&#9654;</span>
        {label}
      </summary>
      {anchorRect && !open && <HoverPreview content={content} anchorRect={anchorRect} />}
      <div className={styles.xmlContent}>
        {innerSegments.map((seg, i) =>
          seg.kind === 'xml' ? (
            <CollapsibleXmlBlock key={i} tagName={seg.tagName} attributes={seg.attributes} content={seg.content} />
          ) : (
            <span key={i}>{seg.content}</span>
          )
        )}
      </div>
    </details>
  );
}

export function renderTextWithXml(text: string): React.ReactNode {
  const segments = parseXmlBlocks(text);

  if (segments.length === 1 && segments[0].kind === 'text') {
    return text;
  }

  return segments.map((seg, i, arr) => {
    if (seg.kind === 'xml') {
      return <CollapsibleXmlBlock key={i} tagName={seg.tagName} attributes={seg.attributes} content={seg.content} />;
    }
    const prev = arr[i - 1];
    const next = arr[i + 1];
    const betweenXml = prev?.kind === 'xml' || next?.kind === 'xml';
    if (betweenXml && seg.content.trim() === '') {
      return <br key={i} />;
    }
    return <span key={i}>{seg.content}</span>;
  });
}

const getStyles = (theme: GrafanaTheme2) => ({
  xmlDetails: css({
    margin: 0,
  }),
  xmlSummary: css({
    padding: `1px 0`,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: theme.typography.fontFamilyMonospace,
    color: theme.colors.text.disabled,
    userSelect: 'none' as const,
    listStyle: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    '&:hover': {
      color: theme.colors.text.secondary,
    },
    '&::-webkit-details-marker': {
      display: 'none',
    },
  }),
  xmlSummaryArrow: css({
    fontSize: 8,
    transition: 'transform 0.15s ease',
    'details[open] > summary > &': {
      transform: 'rotate(90deg)',
    },
  }),
  xmlContent: css({
    paddingLeft: theme.spacing(1.5),
    fontSize: 11,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    marginLeft: theme.spacing(0.25),
    maxHeight: 400,
    overflowY: 'auto' as const,
  }),
  hoverPopup: css({
    position: 'fixed' as const,
    zIndex: theme.zIndex.tooltip,
    pointerEvents: 'none' as const,
    padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
    background: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    maxWidth: 'calc(100vw - 32px)',
  }),
  hoverPre: css({
    margin: 0,
    fontSize: 11,
    fontFamily: theme.typography.fontFamilyMonospace,
    whiteSpace: 'pre-wrap' as const,
    color: theme.colors.text.secondary,
    lineHeight: 1.5,
  }),
});
