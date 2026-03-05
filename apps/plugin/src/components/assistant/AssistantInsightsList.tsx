import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import * as Assistant from '@grafana/assistant';
import { Icon, useStyles2 } from '@grafana/ui';
import { Loader } from '../Loader';
import { buildSigilAssistantContextItems, buildSigilAssistantPrompt } from '../../content/assistantContext';

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
  const [rawAssistantText, setRawAssistantText] = useState('');
  const [items, setItems] = useState<AssistantInsightDisplayItem[]>([]);
  const [openMenuItemKey, setOpenMenuItemKey] = useState<string | null>(null);
  const [likedItemKeys, setLikedItemKeys] = useState<Record<string, true>>({});
  const [dismissedItemKeys, setDismissedItemKeys] = useState<Record<string, true>>({});
  const [dismissingItemKeys, setDismissingItemKeys] = useState<Record<string, true>>({});
  const [collapsingItemKeys, setCollapsingItemKeys] = useState<Record<string, true>>({});
  const [dismissHeightByItemKey, setDismissHeightByItemKey] = useState<Record<string, number>>({});
  const lastDataContextRef = useRef<string | null>(null);
  const dismissalTimeoutsRef = useRef<number[]>([]);
  const dismissalRafIdsRef = useRef<number[]>([]);
  const listItemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const latestRef = useRef({ prompt, origin, systemPrompt, dataContext, assistant, parseItems });

  const resetInsightsState = useCallback(() => {
    setRawAssistantText('');
    setItems([]);
    setOpenMenuItemKey(null);
    setLikedItemKeys({});
    setDismissedItemKeys({});
    setDismissingItemKeys({});
    setCollapsingItemKeys({});
    setDismissHeightByItemKey({});
  }, []);

  useEffect(() => {
    latestRef.current = { prompt, origin, systemPrompt, dataContext, assistant, parseItems };
  });

  useEffect(() => {
    return () => {
      for (const timeoutId of dismissalTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      dismissalTimeoutsRef.current = [];
      for (const rafId of dismissalRafIdsRef.current) {
        window.cancelAnimationFrame(rafId);
      }
      dismissalRafIdsRef.current = [];
    };
  }, []);

  const runGenerate = useCallback((context: string) => {
    const {
      prompt: currentPrompt,
      origin: currentOrigin,
      systemPrompt: currentSystemPrompt,
      assistant: currentAssistant,
    } = latestRef.current;
    const fullPrompt = [currentPrompt.trim(), '', 'Use the following context as ground truth:', context].join('\n');
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
    const scheduleReset = () => {
      window.setTimeout(() => {
        resetInsightsState();
      }, 0);
    };
    if (!dataContext) {
      lastDataContextRef.current = null;
      scheduleReset();
      return;
    }
    if (assistant.isGenerating) {
      return;
    }
    if (lastDataContextRef.current === dataContext) {
      return;
    }
    lastDataContextRef.current = dataContext;
    scheduleReset();
    runGenerate(dataContext);
  }, [assistant.isGenerating, dataContext, resetInsightsState, runGenerate]);

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
      const prompt = buildSigilAssistantPrompt(promptText);
      if (!prompt.length || !fullAssistant.openAssistant) {
        return;
      }
      fullAssistant.openAssistant({
        origin,
        prompt,
        context: buildSigilAssistantContextItems(),
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

  const onDismiss = useCallback(
    (itemKey: string) => {
      if (dismissedItemKeys[itemKey] || dismissingItemKeys[itemKey]) {
        return;
      }
      setOpenMenuItemKey(null);
      const measuredHeight = Math.ceil(listItemRefs.current[itemKey]?.getBoundingClientRect().height ?? 0);
      setDismissHeightByItemKey((prev) => ({ ...prev, [itemKey]: measuredHeight }));
      setDismissingItemKeys((prev) => ({ ...prev, [itemKey]: true }));
      const rafId = window.requestAnimationFrame(() => {
        setCollapsingItemKeys((prev) => ({ ...prev, [itemKey]: true }));
      });
      dismissalRafIdsRef.current.push(rafId);
      const timeoutId = window.setTimeout(() => {
        setDismissedItemKeys((prev) => ({ ...prev, [itemKey]: true }));
        setDismissingItemKeys((prev) => {
          const next = { ...prev };
          delete next[itemKey];
          return next;
        });
        setCollapsingItemKeys((prev) => {
          const next = { ...prev };
          delete next[itemKey];
          return next;
        });
        setDismissHeightByItemKey((prev) => {
          const next = { ...prev };
          delete next[itemKey];
          return next;
        });
      }, 220);
      dismissalTimeoutsRef.current.push(timeoutId);
    },
    [dismissedItemKeys, dismissingItemKeys]
  );

  const onFeedbackUp = useCallback((itemKey: string) => {
    setLikedItemKeys((prev) => ({ ...prev, [itemKey]: true }));
    setOpenMenuItemKey(null);
  }, []);

  const onFeedbackDown = useCallback(
    (itemKey: string) => {
      onDismiss(itemKey);
    },
    [onDismiss]
  );

  const onRefreshAll = useCallback(() => {
    if (!dataContext || assistant.isGenerating) {
      return;
    }
    resetInsightsState();
    runGenerate(dataContext);
  }, [assistant.isGenerating, dataContext, resetInsightsState, runGenerate]);

  const displayRawText = assistant.isGenerating ? String(assistant.content ?? '') : rawAssistantText;
  const hasItems = visibleItems.length > 0;

  return (
    <aside className={cx(styles.container, className)} aria-label="assistant insights">
      <div className={styles.body}>
        {hasItems ? (
          <>
            <ul className={styles.list}>
              {visibleItems.map((item) => {
                const itemKey = toItemKey(item);
                const isMenuOpen = openMenuItemKey === itemKey;
                const hasThumbsUp = Boolean(likedItemKeys[itemKey]);
                const isDismissing = Boolean(dismissingItemKeys[itemKey]);
                const isCollapsing = Boolean(collapsingItemKeys[itemKey]);
                const dismissHeight = dismissHeightByItemKey[itemKey];
                return (
                  <li
                    key={itemKey}
                    ref={(element) => {
                      listItemRefs.current[itemKey] = element;
                    }}
                    className={cx(
                      styles.listItem,
                      isDismissing ? styles.listItemDismissing : undefined,
                      isCollapsing ? styles.listItemCollapsing : undefined,
                      isMenuOpen ? styles.listItemMenuOpen : undefined
                    )}
                    style={
                      isDismissing && dismissHeight > 0
                        ? ({ '--dismiss-height': `${dismissHeight}px` } as React.CSSProperties)
                        : undefined
                    }
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
                          <button
                            type="button"
                            className={styles.menuItem}
                            role="menuitem"
                            onClick={() => onExplain(item)}
                          >
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
                          <div className={styles.feedbackSection}>
                            <div className={styles.feedbackLabel}>Feedback</div>
                            <div className={styles.feedbackButtons}>
                              <button
                                type="button"
                                className={styles.feedbackButton}
                                role="menuitem"
                                aria-label="Mark insight as helpful"
                                onClick={() => onFeedbackUp(itemKey)}
                              >
                                <Icon name="thumbs-up" size="sm" />
                              </button>
                              <button
                                type="button"
                                className={styles.feedbackButton}
                                role="menuitem"
                                aria-label="Mark insight as incorrect"
                                onClick={() => onFeedbackDown(itemKey)}
                              >
                                <Icon name="thumbs-down" size="sm" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.itemContentRow}>
                      <span className={styles.itemArrow}>
                        {hasThumbsUp ? <Icon name="thumbs-up" size="sm" /> : '→'}
                      </span>
                      <div className={styles.itemContent}>
                        {item.sidebarLabel ? (
                          onSelectItem ? (
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => onSelectItem(item.itemId)}
                            >
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
            <div className={styles.generatedMeta}>
              <span className={styles.generatedLabel}>
                <Icon name="ai" size="sm" />
                <span>AI generated</span>
              </span>
              <button
                type="button"
                className={styles.refreshButton}
                onClick={onRefreshAll}
                disabled={assistant.isGenerating}
              >
                <Icon name="sync" size="sm" />
                <span>Refresh</span>
              </button>
            </div>
          </>
        ) : assistant.isGenerating ? (
          <div className={styles.loaderWrap}>
            <Loader showText={false} />
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
    }),
    listItem: css({
      position: 'relative',
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.primary.main}2d`,
      boxShadow: `0 0 0 1px ${theme.colors.primary.main}14, 0 0 10px ${theme.colors.primary.main}1f`,
      padding: theme.spacing(1.5),
      marginBottom: theme.spacing(1.5),
      overflow: 'hidden',
      transition:
        'height 220ms ease, margin-bottom 220ms ease, padding-top 220ms ease, padding-bottom 220ms ease, border-width 220ms ease, opacity 220ms ease, transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease',
      '&:last-child': {
        marginBottom: 0,
      },
      '&:hover, &:focus-within': {
        borderColor: `${theme.colors.primary.main}4d`,
        boxShadow: `0 0 0 1px ${theme.colors.primary.main}24, 0 0 14px ${theme.colors.primary.main}2b`,
      },
    }),
    listItemDismissing: css({
      height: 'var(--dismiss-height)',
    }),
    listItemCollapsing: css({
      opacity: 0,
      transform: 'translateY(-2px)',
      height: 0,
      marginBottom: 0,
      paddingTop: 0,
      paddingBottom: 0,
      borderWidth: 0,
    }),
    listItemMenuOpen: css({
      zIndex: 5,
      overflow: 'visible',
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
    feedbackSection: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      padding: `${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
    }),
    feedbackLabel: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    feedbackButtons: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
    feedbackButton: css({
      border: 'none',
      background: 'transparent',
      color: theme.colors.text.primary,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(0.5),
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      '&:hover': {
        background: theme.colors.action.hover,
      },
    }),
    placeholder: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      fontStyle: 'italic',
    }),
    generatedMeta: css({
      marginTop: theme.spacing(1),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      color: theme.colors.text.disabled,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    generatedLabel: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
    }),
    refreshButton: css({
      border: 'none',
      background: 'transparent',
      color: theme.colors.primary.text,
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: 0,
      cursor: 'pointer',
      fontSize: theme.typography.bodySmall.fontSize,
      '&:hover': {
        color: theme.colors.primary.main,
      },
      '&:disabled': {
        color: theme.colors.text.disabled,
        cursor: 'default',
      },
    }),
  };
}
