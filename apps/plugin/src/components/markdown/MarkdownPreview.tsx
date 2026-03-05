import React, { useMemo } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'code'; language: string; code: string };

export type MarkdownPreviewProps = {
  markdown: string;
  className?: string;
};

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    color: theme.colors.text.primary,
    lineHeight: 1.55,
    fontSize: theme.typography.bodySmall.fontSize,
    overflowWrap: 'anywhere' as const,
  }),
  heading: css({
    margin: `${theme.spacing(1)} 0 ${theme.spacing(0.5)} 0`,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.4,
  }),
  paragraph: css({
    margin: `${theme.spacing(0.75)} 0`,
    whiteSpace: 'pre-wrap' as const,
  }),
  list: css({
    margin: `${theme.spacing(0.75)} 0`,
    paddingLeft: theme.spacing(2.5),
  }),
  listItem: css({
    margin: `${theme.spacing(0.25)} 0`,
    whiteSpace: 'pre-wrap' as const,
  }),
  codeBlock: css({
    margin: `${theme.spacing(1)} 0`,
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    overflowX: 'auto' as const,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.45,
    whiteSpace: 'pre' as const,
  }),
  inlineCode: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: '0 4px',
  }),
  link: css({
    color: theme.colors.text.link,
    textDecoration: 'underline',
  }),
});

export default function MarkdownPreview({ markdown, className }: MarkdownPreviewProps) {
  const styles = useStyles2(getStyles);
  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown]);

  return (
    <div className={cx(styles.root, className)}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const HeadingTag = `h${block.level}` as keyof React.JSX.IntrinsicElements;
          return (
            <HeadingTag key={`heading-${index}`} className={styles.heading}>
              {renderInlineMarkdown(block.text, `heading-${index}`, styles)}
            </HeadingTag>
          );
        }

        if (block.type === 'unordered-list') {
          return (
            <ul key={`ul-${index}`} className={styles.list}>
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}:${item}`} className={styles.listItem}>
                  {renderInlineMarkdown(item, `ul-${index}-${itemIndex}`, styles)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={`ol-${index}`} className={styles.list}>
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}:${item}`} className={styles.listItem}>
                  {renderInlineMarkdown(item, `ol-${index}-${itemIndex}`, styles)}
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === 'code') {
          return (
            <pre key={`code-${index}`} className={styles.codeBlock}>
              <code>{block.code}</code>
            </pre>
          );
        }

        return (
          <p key={`paragraph-${index}`} className={styles.paragraph}>
            {renderInlineMarkdown(block.text, `paragraph-${index}`, styles)}
          </p>
        );
      })}
    </div>
  );
}

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  styles: ReturnType<typeof getStyles>
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern =
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~]+)~~/g;

  let cursor = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const fullMatch = match[0];
    const start = match.index ?? 0;
    const end = start + fullMatch.length;

    if (start > cursor) {
      parts.push(text.slice(cursor, start));
    }

    if (match[1] && match[2]) {
      const safeHref = sanitizeMarkdownUrl(match[2]);
      if (safeHref) {
        parts.push(
          <a
            key={`${keyPrefix}-link-${tokenIndex}`}
            className={styles.link}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            title={match[3]}
          >
            {match[1]}
          </a>
        );
      } else {
        parts.push(match[1]);
      }
    } else if (match[4]) {
      parts.push(
        <code key={`${keyPrefix}-code-${tokenIndex}`} className={styles.inlineCode}>
          {match[4]}
        </code>
      );
    } else if (match[5] || match[6]) {
      parts.push(<strong key={`${keyPrefix}-strong-${tokenIndex}`}>{match[5] ?? match[6]}</strong>);
    } else if (match[7] || match[8]) {
      parts.push(<em key={`${keyPrefix}-em-${tokenIndex}`}>{match[7] ?? match[8]}</em>);
    } else if (match[9]) {
      parts.push(<del key={`${keyPrefix}-del-${tokenIndex}`}>{match[9]}</del>);
    } else {
      parts.push(fullMatch);
    }

    cursor = end;
    tokenIndex++;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}

function sanitizeMarkdownUrl(input: string): string | null {
  const rawUrl = input.trim().replace(/[\t\r\n]/g, '');
  if (rawUrl.length === 0) {
    return null;
  }

  const hasDisallowedProtocol = /^(?:javascript|data|vbscript|file):/i.test(rawUrl);
  if (hasDisallowedProtocol) {
    return null;
  }

  const isRelativeUrl =
    rawUrl.startsWith('/') ||
    rawUrl.startsWith('./') ||
    rawUrl.startsWith('../') ||
    rawUrl.startsWith('#') ||
    rawUrl.startsWith('?');

  if (isRelativeUrl) {
    return rawUrl;
  }

  try {
    const parsedUrl = new URL(rawUrl);
    const isAllowedProtocol =
      parsedUrl.protocol === 'http:' ||
      parsedUrl.protocol === 'https:' ||
      parsedUrl.protocol === 'mailto:' ||
      parsedUrl.protocol === 'tel:';
    return isAllowedProtocol ? parsedUrl.toString() : null;
  } catch {
    return null;
  }
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listType: 'ordered-list' | 'unordered-list' | null = null;
  let inCodeBlock = false;
  let codeLanguage = '';
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n').trimEnd() });
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0 || listType === null) {
      return;
    }
    blocks.push({ type: listType, items: [...listItems] });
    listItems = [];
    listType = null;
  };

  const flushCode = () => {
    if (!inCodeBlock) {
      return;
    }
    blocks.push({ type: 'code', language: codeLanguage, code: codeLines.join('\n') });
    inCodeBlock = false;
    codeLanguage = '';
    codeLines = [];
  };

  for (let i = 0; i <= lines.length; i++) {
    const line = i < lines.length ? lines[i] : '';
    const trimmed = line.trim();

    if (inCodeBlock) {
      if (trimmed.startsWith('```')) {
        flushCode();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushList();
      inCodeBlock = true;
      codeLanguage = trimmed.slice(3).trim();
      continue;
    }

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    const unorderedListMatch = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (unorderedListMatch) {
      flushParagraph();
      if (listType !== 'unordered-list') {
        flushList();
        listType = 'unordered-list';
      }
      listItems.push(unorderedListMatch[1].trim());
      continue;
    }

    const orderedListMatch = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (orderedListMatch) {
      flushParagraph();
      if (listType !== 'ordered-list') {
        flushList();
        listType = 'ordered-list';
      }
      listItems.push(orderedListMatch[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  if (inCodeBlock) {
    flushCode();
  }
  flushParagraph();
  flushList();
  return blocks;
}
