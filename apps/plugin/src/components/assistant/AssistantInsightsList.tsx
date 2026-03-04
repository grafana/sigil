import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import * as Assistant from '@grafana/assistant';
import { ConfirmModal, Spinner, useStyles2 } from '@grafana/ui';

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
  const fullAssistant = Assistant.useAssistant();
  const AssistantLoader = (Assistant as { Loader?: React.ComponentType }).Loader;
  const [rawAssistantText, setRawAssistantText] = useState('');
  const [items, setItems] = useState<AssistantInsightDisplayItem[]>([]);
  const [openMenuItemKey, setOpenMenuItemKey] = useState<string | null>(null);
  const [reportItemKey, setReportItemKey] = useState<string | null>(null);
  const [dismissedItemKeys, setDismissedItemKeys] = useState<Record<string, true>>({});
  const [dismissingItemKeys, setDismissingItemKeys] = useState<Record<string, true>>({});
  const lastDataContextRef = useRef<string | null>(null);
  const dismissalTimeoutsRef = useRef<number[]>([]);
  const latestRef = useRef({ prompt, origin, systemPrompt, dataContext, assistant, parseItems });

  useEffect(() => {
    latestRef.current = { prompt, origin, systemPrompt, dataContext, assistant, parseItems };
  });

  useEffect(() => {
    return () => {
      for (const timeoutId of dismissalTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      dismissalTimeoutsRef.current = [];
    };
  }, []);

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
      setOpenMenuItemKey(null);
      setReportItemKey(null);
      setDismissedItemKeys({});
      setDismissingItemKeys({});
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
    setOpenMenuItemKey(null);
    setReportItemKey(null);
    setDismissedItemKeys({});
    setDismissingItemKeys({});
    runGenerate(dataContext);
  }, [assistant.isGenerating, dataContext, runGenerate]);

  useEffect(() => {
    if (!openMenuItemKey) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const scopedParent = event.target.closest('[data-insight-menu-scope]');
      if (!(scopedParent instanceof HTMLElement)) {
        setOpenMenuItemKey(null);
        return;
      }
      if (scopedParent.dataset.insightMenuScope !== openMenuItemKey) {
        setOpenMenuItemKey(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [openMenuItemKey]);

  const toItemKey = useCallback((item: AssistantInsightDisplayItem) => `${item.itemId}:${item.focus}`, []);

  const visibleItems = useMemo(
    () => items.filter((item) => !dismissedItemKeys[toItemKey(item)]),
    [dismissedItemKeys, items, toItemKey]
  );

  const openAssistantPrompt = useCallback(
    (promptText: string) => {
      const prompt = promptText.trim();
      if (!prompt.length || !fullAssistant.openAssistant) {
        return;
      }
      fullAssistant.openAssistant({
        origin,
        prompt,
        autoSend: true,
      });
    },
    [fullAssistant, origin]
  );

  const onExplain = useCallback(
    (item: AssistantInsightDisplayItem) => {
      const prompt = [
        'Explain this insight in simple terms for a non-expert.',
        '',
        `Insight: ${item.focus}`,
        item.tip ? `Tip: ${item.tip}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      openAssistantPrompt(prompt);
      setOpenMenuItemKey(null);
    },
    [openAssistantPrompt]
  );

  const onInvestigate = useCallback(
    (item: AssistantInsightDisplayItem) => {
      const prompt = [
        'Investigate this insight deeply. Explore possible causes, likely impact, and concrete next checks.',
        '',
        `Insight: ${item.focus}`,
        item.tip ? `Tip: ${item.tip}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      openAssistantPrompt(prompt);
      setOpenMenuItemKey(null);
    },
    [openAssistantPrompt]
  );

  const onReportIrrelevant = useCallback((itemKey: string) => {
    setOpenMenuItemKey(null);
    setReportItemKey(itemKey);
  }, []);

  const onDismiss = useCallback((itemKey: string) => {
    setOpenMenuItemKey(null);
    setDismissingItemKeys((prev) => ({ ...prev, [itemKey]: true }));
    const timeoutId = window.setTimeout(() => {
      setDismissedItemKeys((prev) => ({ ...prev, [itemKey]: true }));
      setDismissingItemKeys((prev) => {
        const next = { ...prev };
        delete next[itemKey];
        return next;
      });
    }, 220);
    dismissalTimeoutsRef.current.push(timeoutId);
  }, []);

  const displayRawText = assistant.isGenerating ? String(assistant.content ?? '') : rawAssistantText;
  const hasItems = visibleItems.length > 0;

  return (
    <aside className={cx(styles.container, className)} aria-label="assistant insights">
      <div className={styles.body}>
        {hasItems ? (
          <ul className={styles.list}>
            {visibleItems.map((item) => {
              const itemKey = toItemKey(item);
              const isMenuOpen = openMenuItemKey === itemKey;
              const isDismissing = Boolean(dismissingItemKeys[itemKey]);
              return (
                <li
                  key={itemKey}
                  className={cx(
                    styles.listItem,
                    isDismissing ? styles.listItemDismissing : undefined,
                    isMenuOpen ? styles.listItemMenuOpen : undefined
                  )}
                  data-insight-menu-scope={itemKey}
                >
                  <div className={styles.menuWrap}>
                    <button
                      type="button"
                      className={styles.menuButton}
                      aria-label="Insight actions"
                      aria-expanded={isMenuOpen}
                      onClick={() => setOpenMenuItemKey(isMenuOpen ? null : itemKey)}
                    >
                      ...
                    </button>
                    {isMenuOpen ? (
                      <div className={styles.menuPanel} role="menu">
                        <button type="button" className={styles.menuItem} role="menuitem" onClick={() => onExplain(item)}>
                          Explain
                        </button>
                        <button
                          type="button"
                          className={styles.menuItem}
                          role="menuitem"
                          onClick={() => onInvestigate(item)}
                        >
                          Investigate
                        </button>
                        <div className={styles.menuDivider} />
                        <button
                          type="button"
                          className={styles.menuItem}
                          role="menuitem"
                          onClick={() => onReportIrrelevant(itemKey)}
                        >
                          Report as irrelevant
                        </button>
                        <button type="button" className={styles.menuItem} role="menuitem" onClick={() => onDismiss(itemKey)}>
                          Dismiss
                        </button>
                      </div>
                    ) : null}
                  </div>
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
              );
            })}
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
      {reportItemKey ? (
        <ConfirmModal
          isOpen
          title="Report this insight as irrelevant?"
          body="This will be wired up soon. For now this action is a no-op."
          confirmText="Report"
          onConfirm={() => {
            const itemKey = reportItemKey;
            setReportItemKey(null);
            onDismiss(itemKey);
          }}
          onDismiss={() => setReportItemKey(null)}
        />
      ) : null}
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
      transition: 'opacity 220ms ease, transform 220ms ease',
    }),
    listItemDismissing: css({
      opacity: 0,
      transform: 'translateY(-2px)',
    }),
    listItemMenuOpen: css({
      zIndex: 5,
    }),
    itemContentRow: css({
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(1),
      paddingRight: theme.spacing(3),
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
    menuWrap: css({
      position: 'absolute',
      top: theme.spacing(1.25),
      right: theme.spacing(1),
      zIndex: 2,
    }),
    menuButton: css({
      border: 'none',
      background: 'transparent',
      color: theme.colors.text.disabled,
      cursor: 'pointer',
      padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
      borderRadius: theme.shape.radius.default,
      lineHeight: 1,
      fontWeight: theme.typography.fontWeightBold,
      '&:hover': {
        background: theme.colors.action.hover,
        color: theme.colors.text.primary,
      },
    }),
    menuPanel: css({
      position: 'absolute',
      top: 'calc(100% + 4px)',
      right: 0,
      minWidth: 190,
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.primary,
      boxShadow: theme.shadows.z3,
      padding: theme.spacing(0.5),
    }),
    menuItem: css({
      border: 'none',
      background: 'transparent',
      color: theme.colors.text.primary,
      textAlign: 'left',
      fontSize: theme.typography.bodySmall.fontSize,
      borderRadius: theme.shape.radius.default,
      padding: `${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
      cursor: 'pointer',
      '&:hover': {
        background: theme.colors.action.hover,
      },
    }),
    menuDivider: css({
      height: 1,
      background: theme.colors.border.weak,
      margin: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
    }),
    placeholder: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      fontStyle: 'italic',
    }),
  };
}
