import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import * as Assistant from '@grafana/assistant';
import { Spinner, useStyles2 } from '@grafana/ui';

export type AssistantInsightDisplayItem = {
  itemId: string;
  sidebarLabel?: string;
  focus: string;
  tip?: string;
};

export type AssistantInsightsListProps = {
  prompt: string;
  origin: string;
  systemPrompt: string;
  dataContext: string | null;
  parseItems?: (rawAssistantText: string) => AssistantInsightDisplayItem[];
  onSelectItem?: (itemId: string) => void;
  className?: string;
  waitingText?: string;
  emptyText?: string;
  invalidText?: string;
};

export default function AssistantInsightsList({
  prompt,
  origin,
  systemPrompt,
  dataContext,
  parseItems = parseBulletItems,
  onSelectItem,
  className,
  waitingText = 'Waiting for data...',
  emptyText = 'No notable insights.',
  invalidText = 'Could not parse assistant insights.',
}: AssistantInsightsListProps) {
  const styles = useStyles2(getStyles);
  const assistant = Assistant.useInlineAssistant();
  const AssistantLoader = (Assistant as { Loader?: React.ComponentType }).Loader;
  const [rawAssistantText, setRawAssistantText] = useState('');
  const [items, setItems] = useState<AssistantInsightDisplayItem[]>([]);
  const lastDataContextRef = useRef<string | null>(null);
  const latestRef = useRef({ prompt, origin, systemPrompt, dataContext, assistant, parseItems });

  useEffect(() => {
    latestRef.current = { prompt, origin, systemPrompt, dataContext, assistant, parseItems };
  });

  const runGenerate = useCallback((context: string) => {
    const { prompt: currentPrompt, origin: currentOrigin, systemPrompt: currentSystemPrompt, assistant: currentAssistant } =
      latestRef.current;
    const fullPrompt = `${currentPrompt}\n\n${context}`;
    currentAssistant.generate({
      prompt: fullPrompt,
      origin: currentOrigin,
      systemPrompt: currentSystemPrompt,
      onComplete: (result: string) => {
        setRawAssistantText(result);
        try {
          setItems(latestRef.current.parseItems(result));
        } catch (err) {
          console.error('Assistant insights parse failed:', err);
          setItems([]);
        }
      },
      onError: (err: Error) => {
        console.error('Assistant insights generation failed:', err);
        setRawAssistantText('');
        setItems([]);
      },
    });
  }, []);

  useEffect(() => {
    if (!dataContext) {
      lastDataContextRef.current = null;
      setRawAssistantText('');
      setItems([]);
      return;
    }
    if (assistant.isGenerating) {
      return;
    }
    if (lastDataContextRef.current === dataContext) {
      return;
    }
    lastDataContextRef.current = dataContext;
    setRawAssistantText('');
    setItems([]);
    runGenerate(dataContext);
  }, [assistant.isGenerating, dataContext, runGenerate]);

  const displayRawText = assistant.isGenerating ? String(assistant.content ?? '') : rawAssistantText;
  const hasItems = items.length > 0;

  return (
    <aside className={cx(styles.container, className)} aria-label="assistant insights">
      <div className={styles.body}>
        {hasItems ? (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={`${item.itemId}:${item.focus}`} className={styles.listItem}>
                <div className={styles.itemContentRow}>
                  <span className={styles.itemArrow}>→</span>
                  <div className={styles.itemContent}>
                    {item.sidebarLabel ? (
                      onSelectItem ? (
                        <button type="button" className={styles.linkButton} onClick={() => onSelectItem(item.itemId)}>
                          {item.sidebarLabel}
                        </button>
                      ) : (
                        <div className={styles.sidebarLabel}>{item.sidebarLabel}</div>
                      )
                    ) : null}
                    <div className={styles.focusText}>{formatInlineMarkup(item.focus)}</div>
                    {item.tip ? <div className={styles.tipText}>Tip: {formatInlineMarkup(item.tip)}</div> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : assistant.isGenerating ? (
          <div className={styles.loaderWrap}>
            {AssistantLoader ? <AssistantLoader /> : <Spinner size="sm" />}
          </div>
        ) : dataContext === null ? (
          <div className={styles.placeholder}>{waitingText}</div>
        ) : displayRawText.trim().length > 0 ? (
          <div className={styles.placeholder}>{invalidText}</div>
        ) : (
          <div className={styles.placeholder}>{emptyText}</div>
        )}
      </div>
    </aside>
  );
}

function parseBulletItems(rawAssistantText: string): AssistantInsightDisplayItem[] {
  return rawAssistantText
    .split('\n')
    .map((line: string, i: number) => ({
      itemId: `assistant-insight-${i}`,
      focus: line.replace(/^[-•*]\s*/, '').trim(),
    }))
    .filter((item) => item.focus.length > 0);
}

function formatInlineMarkup(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`(.+?)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      parts.push(<strong key={match.index}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      parts.push(<code key={match.index}>{match[2]}</code>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function cx(...classNames: Array<string | undefined>): string {
  return classNames.filter((name): name is string => Boolean(name)).join(' ');
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: theme.colors.background.primary,
    }),
    body: css({
      minHeight: 0,
      overflowY: 'auto',
      padding: theme.spacing(1.5),
    }),
    loaderWrap: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 20,
    }),
    list: css({
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
    }),
    listItem: css({
      position: 'relative',
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      padding: theme.spacing(1.5),
    }),
    itemContentRow: css({
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(1),
    }),
    itemArrow: css({
      flexShrink: 0,
      color: theme.colors.text.disabled,
      fontWeight: theme.typography.fontWeightBold,
      lineHeight: 1.5,
    }),
    itemContent: css({
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    linkButton: css({
      display: 'inline-flex',
      width: 'fit-content',
      alignSelf: 'flex-start',
      justifyContent: 'flex-start',
      textAlign: 'left',
      border: 'none',
      padding: 0,
      background: 'transparent',
      color: theme.colors.primary.text,
      textDecoration: 'underline',
      fontSize: theme.typography.bodySmall.fontSize,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontWeight: theme.typography.fontWeightMedium,
      cursor: 'pointer',
      '&:hover': {
        color: theme.colors.primary.main,
      },
    }),
    sidebarLabel: css({
      color: theme.colors.text.primary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontWeight: theme.typography.fontWeightMedium,
    }),
    focusText: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.6,
      '& strong': {
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.text.primary,
      },
      '& code': {
        fontSize: '0.85em',
        padding: '1px 4px',
        borderRadius: theme.shape.radius.default,
        background: theme.colors.background.primary,
        fontFamily: theme.typography.fontFamilyMonospace,
      },
    }),
    tipText: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      fontStyle: 'italic',
      '& strong': {
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.text.primary,
      },
      '& code': {
        fontSize: '0.85em',
        padding: '1px 4px',
        borderRadius: theme.shape.radius.default,
        background: theme.colors.background.primary,
        fontFamily: theme.typography.fontFamilyMonospace,
      },
    }),
    placeholder: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      fontStyle: 'italic',
    }),
  };
}
