import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, dateTime, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { initPluginTranslations } from '@grafana/i18n';
import {
  EmbeddedScene,
  PanelBuilders,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneTimeRange,
} from '@grafana/scenes';
import { Alert, Button, Icon, Input, Modal, Tooltip, useStyles2 } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import { resolveConversationUserId } from '../conversation/userIdentity';
import { createTempoTraceFetcher } from '../conversation/fetchTrace';
import type { TraceFetcher } from '../conversation/loader';
import type { ConversationRating, ConversationSpan } from '../conversation/types';
import { plugin } from '../module';
import { defaultModelCardClient, type ModelCardClient } from '../modelcard/api';
import { resolveConversationTitleFromTelemetry } from '../conversation/conversationTitle';
import { useConversationData } from '../hooks/useConversationData';
import { useSavedConversation } from '../hooks/useSavedConversation';
import {
  useConversationFlow,
  type FlowGroupBy,
  type FlowSortBy,
} from '../components/conversation-explore/useConversationFlow';
import MetricsBar from '../components/conversation-explore/MetricsBar';
import FlowTree from '../components/conversation-explore/FlowTree';
import MiniTimeline from '../components/conversation-explore/MiniTimeline';
import DetailPanel from '../components/conversation-explore/DetailPanel';
import type { FlowNode } from '../components/conversation-explore/types';
import { Loader } from '../components/Loader';
import { PageInsightBar } from '../components/insight/PageInsightBar';

export type ConversationExplorePageProps = {
  dataSource?: ConversationsDataSource;
  traceFetcher?: TraceFetcher;
  modelCardClient?: ModelCardClient;
};

const defaultTraceFetcher = createTempoTraceFetcher();

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    overflow: 'hidden',
    background: theme.colors.background.canvas,
  }),
  topSection: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1),
    padding: theme.spacing(1, 0),
    flexShrink: 0,
  }),
  spinnerWrap: css({
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  }),
  errorWrap: css({
    padding: theme.spacing(2),
  }),
  insightRow: css({
    paddingBottom: '2px',
    flexShrink: 0,
  }),
  contentArea: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'row' as const,
    minHeight: 0,
    overflow: 'hidden',
  }),
  leftPanel: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flexShrink: 0,
    background: theme.colors.background.primary,
    overflow: 'hidden',
  }),
  collapsedRail: css({
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    flexShrink: 0,
    width: 28,
    paddingTop: theme.spacing(1),
    background: theme.colors.background.primary,
    borderRight: `1px solid ${theme.colors.border.weak}`,
  }),
  expandButton: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(0.5),
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: theme.colors.text.disabled,
    borderRadius: theme.shape.radius.default,
    transition: 'color 120ms ease',
    '&:hover': {
      color: theme.colors.text.primary,
    },
  }),
  resizeHandle: css({
    width: 4,
    flexShrink: 0,
    cursor: 'col-resize',
    background: theme.colors.border.weak,
    transition: 'background 150ms ease',
    '&:hover, &:active': {
      background: theme.colors.primary.border,
    },
  }),
  rightPanel: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 0,
    overflow: 'hidden',
  }),
  rightPanelContent: css({
    flex: 1,
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
  }),
  detailPanelWrap: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  }),
  saveModal: css({
    width: 400,
  }),
  saveModalInput: css({
    paddingBottom: theme.spacing(0.5),
  }),
  traceDrawerPanel: css({
    display: 'flex',
    flexDirection: 'column' as const,
    background: theme.colors.background.primary,
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
    minHeight: 0,
    flexShrink: 0,
  }),
  traceDrawerHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    boxSizing: 'border-box',
    height: 28,
    padding: `0 ${theme.spacing(1.5)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    flexShrink: 0,
  }),
  traceDrawerTitle: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.375),
    fontSize: 9,
    lineHeight: 1,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    '& svg': {
      width: 12,
      height: 12,
    },
  }),
  traceDrawerBody: css({
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  }),
  tracePanelHost: css({
    height: '100%',
    minHeight: 0,
    background: theme.colors.background.primary,
    '& > div': {
      height: '100%',
      minHeight: 0,
      borderRadius: 0,
    },
    '& section[data-testid="data-testid Panel header "]': {
      borderRadius: 0,
    },
    '& [data-testid="data-testid panel content"]': {
      height: '100%',
      borderRadius: 0,
    },
    '& [data-testid="data-testid panel content"] > div': {
      overflow: 'auto',
      height: '100%',
      borderRadius: 0,
    },
    '& .TracePageHeader': {
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
    },
  }),
  tracePanelMessage: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: theme.spacing(2),
  }),
  tracePanelScene: css({
    height: '100%',
    minHeight: 0,
    overflow: 'auto',
    '& > div': {
      height: '100%',
      minHeight: 0,
      borderRadius: 0,
    },
    '& section[data-testid="data-testid Panel header "]': {
      borderRadius: 0,
    },
    '& [data-testid="data-testid panel content"]': {
      height: '100%',
      borderRadius: 0,
    },
    '& [data-testid="data-testid panel content"] > div': {
      overflow: 'auto',
      minHeight: '100%',
      borderRadius: 0,
    },
    '& .TracePageHeader': {
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
    },
  }),
  traceDrawerClose: css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    background: 'transparent',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    '&:hover': {
      background: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),
});

type GrafanaTracePanelProps = {
  traceId: string;
  spanId?: string;
  timeRange: TimeRange;
};

function normalizeTracePanelSpanId(spanId: string | undefined): string | undefined {
  if (!spanId) {
    return undefined;
  }

  const trimmed = spanId.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (/^[0-9a-f]{16}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  try {
    const binary = window.atob(trimmed);
    const hex = Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return /^[0-9a-f]{16}$/i.test(hex) ? hex.toLowerCase() : trimmed;
  } catch {
    return trimmed;
  }
}

function findTraceActionButton(container: HTMLElement, label: string): HTMLButtonElement | null {
  const normalizedLabel = label.trim().toLowerCase();
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));

  return (
    buttons.find((button) => {
      const ariaLabel = button.getAttribute('aria-label')?.trim().toLowerCase() ?? '';
      const title = button.getAttribute('title')?.trim().toLowerCase() ?? '';
      const text = button.textContent?.trim().toLowerCase() ?? '';
      return ariaLabel.includes(normalizedLabel) || title.includes(normalizedLabel) || text.includes(normalizedLabel);
    }) ?? null
  );
}

function findTraceTargetElement(container: HTMLElement, traceId: string, spanId: string): HTMLElement | null {
  const itemKey = `${traceId}--${spanId}--bar`;
  return container.querySelector<HTMLElement>(`[data-item-key="${itemKey}"]`);
}

function findTraceTargetToggle(target: HTMLElement): HTMLElement | null {
  return target.querySelector<HTMLElement>('button[role="switch"]');
}

function findTraceListView(target: HTMLElement): HTMLElement | null {
  return target.closest<HTMLElement>('[data-testid="ListView"]');
}

function scrollTraceTargetIntoView(target: HTMLElement): void {
  const listView = findTraceListView(target);
  if (!listView) {
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    return;
  }

  const top = Number.parseFloat(target.style.top || '0');
  if (!Number.isFinite(top)) {
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    return;
  }

  const centeredTop = Math.max(0, top - listView.clientHeight / 2 + target.clientHeight / 2);
  listView.scrollTop = centeredTop;
}

function isTraceTargetExpanded(target: HTMLElement): boolean {
  const row = target.firstElementChild as HTMLElement | null;
  const toggle = findTraceTargetToggle(target);
  return row?.className.includes('rowExpanded') === true || toggle?.getAttribute('aria-checked') === 'true';
}

function findOverviewToggle(container: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-controls]'));
  return (
    buttons.find((button) => {
      const controlsId = button.getAttribute('aria-controls');
      if (!controlsId) {
        return false;
      }

      const controlledElement = container.querySelector<HTMLElement>(`#${CSS.escape(controlsId)}`);
      const labelContainer =
        button.nextElementSibling instanceof HTMLElement
          ? button.nextElementSibling
          : button.parentElement instanceof HTMLElement
            ? button.parentElement
            : null;

      const labelText = labelContainer?.textContent?.trim().toLowerCase() ?? '';
      const controlledText = controlledElement?.previousElementSibling?.textContent?.trim().toLowerCase() ?? '';
      return labelText.includes('overview') || controlledText.includes('overview');
    }) ?? null
  );
}

function GrafanaTracePanel({ traceId, spanId, timeRange }: GrafanaTracePanelProps) {
  const styles = useStyles2(getStyles);
  const tempoDatasourceUID = (
    plugin.meta.jsonData as { tempoDatasourceUID?: string } | undefined
  )?.tempoDatasourceUID?.trim();
  const [scene, setScene] = useState<EmbeddedScene | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const collapsedOverviewKeyRef = useRef<string | null>(null);
  const normalizedSpanId = useMemo(() => normalizeTracePanelSpanId(spanId), [spanId]);

  useEffect(() => {
    if (!tempoDatasourceUID) {
      return;
    }

    let cancelled = false;

    const buildScene = async () => {
      await initPluginTranslations(plugin.meta.id, []);
      if (cancelled) {
        return;
      }

      const queryRunner = new SceneQueryRunner({
        datasource: { uid: tempoDatasourceUID },
        queries: [{ refId: 'A', query: traceId, queryType: 'traceql' }],
      });

      const tracePanel = PanelBuilders.traces().setHoverHeader(true);
      if (normalizedSpanId) {
        tracePanel.setOption('focusedSpanId' as never, normalizedSpanId as never);
      }

      const sceneTimeRange = new SceneTimeRange({
        value: timeRange,
        from: timeRange.raw.from.toString(),
        to: timeRange.raw.to.toString(),
      });

      setScene(
        new EmbeddedScene({
          $data: queryRunner,
          $timeRange: sceneTimeRange,
          body: new SceneFlexLayout({
            direction: 'column',
            children: [
              new SceneFlexItem({
                height: '100%',
                minHeight: 0,
                body: tracePanel.build(),
              }),
            ],
          }),
        })
      );
    };

    const frame = requestAnimationFrame(() => {
      void buildScene();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [normalizedSpanId, tempoDatasourceUID, timeRange, traceId]);

  useEffect(() => {
    if (!scene || !hostRef.current) {
      return;
    }

    const collapseKey = `${traceId}:${normalizedSpanId ?? ''}`;
    if (collapsedOverviewKeyRef.current === collapseKey) {
      return;
    }

    let cancelled = false;
    let timerId: number | undefined;
    let observer: MutationObserver | undefined;
    let collapseAttempts = 0;
    const MAX_COLLAPSE_ATTEMPTS = 120;

    const stopCollapse = () => {
      observer?.disconnect();
      if (timerId !== undefined) {
        window.clearInterval(timerId);
        timerId = undefined;
      }
    };

    const collapseOverview = (): boolean => {
      if (cancelled || !hostRef.current) {
        return false;
      }

      const overviewToggle = findOverviewToggle(hostRef.current);
      if (!overviewToggle) {
        return false;
      }

      if (overviewToggle.getAttribute('aria-expanded') === 'true') {
        overviewToggle.click();
      }

      if (overviewToggle.getAttribute('aria-expanded') === 'false') {
        collapsedOverviewKeyRef.current = collapseKey;
        return true;
      }

      return false;
    };

    observer = new MutationObserver(() => {
      if (collapseOverview()) {
        stopCollapse();
      }
    });

    observer.observe(hostRef.current, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
    });

    timerId = window.setInterval(() => {
      collapseAttempts++;
      if (collapseOverview() || collapseAttempts >= MAX_COLLAPSE_ATTEMPTS) {
        stopCollapse();
      }
    }, 150);

    collapseOverview();

    return () => {
      cancelled = true;
      stopCollapse();
    };
  }, [normalizedSpanId, scene, traceId]);

  useEffect(() => {
    if (!scene || !hostRef.current || !normalizedSpanId) {
      return;
    }

    let cancelled = false;
    let retryTimeoutId: number | undefined;
    let intervalId: number | undefined;
    let observer: MutationObserver | undefined;
    let focusAttempts = 0;
    const MAX_FOCUS_ATTEMPTS = 120;

    const clearRetryTimeout = () => {
      if (retryTimeoutId !== undefined) {
        window.clearTimeout(retryTimeoutId);
        retryTimeoutId = undefined;
      }
    };

    const stopAll = () => {
      cancelled = true;
      observer?.disconnect();
      clearRetryTimeout();
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const focusSpan = (): boolean => {
      if (cancelled || !hostRef.current) {
        return false;
      }

      const targetElement = findTraceTargetElement(hostRef.current, traceId, normalizedSpanId);
      if (targetElement) {
        scrollTraceTargetIntoView(targetElement);

        if (isTraceTargetExpanded(targetElement)) {
          return true;
        }

        const targetToggle = findTraceTargetToggle(targetElement);
        if (targetToggle) {
          targetToggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }

        clearRetryTimeout();
        retryTimeoutId = window.setTimeout(() => {
          if (!cancelled) {
            void focusSpan();
          }
        }, 150);
        return false;
      }

      const expandOneButton = findTraceActionButton(hostRef.current, 'expand +1');
      if (expandOneButton) {
        expandOneButton.click();
      }

      const expandAllButton = findTraceActionButton(hostRef.current, 'expand all');
      if (expandAllButton) {
        expandAllButton.click();
      }

      return false;
    };

    observer = new MutationObserver(() => {
      if (focusSpan()) {
        stopAll();
      }
    });

    observer.observe(hostRef.current, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'aria-checked', 'style', 'data-item-key'],
    });

    focusSpan();
    intervalId = window.setInterval(() => {
      focusAttempts++;
      if (focusSpan() || focusAttempts >= MAX_FOCUS_ATTEMPTS) {
        stopAll();
      }
    }, 250);

    return stopAll;
  }, [normalizedSpanId, scene, traceId]);

  if (!tempoDatasourceUID) {
    return (
      <div className={styles.tracePanelMessage}>
        <Alert severity="warning" title="Tempo datasource not configured">
          Configure a Tempo datasource in the Sigil plugin settings to open the Grafana trace view.
        </Alert>
      </div>
    );
  }

  if (!scene) {
    return <div className={styles.tracePanelHost} />;
  }

  return (
    <div className={styles.tracePanelScene} ref={hostRef}>
      <scene.Component model={scene} />
    </div>
  );
}

export default function ConversationExplorePage(props: ConversationExplorePageProps) {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const { conversationID = '' } = useParams<{ conversationID?: string }>();

  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const traceFetcher = props.traceFetcher ?? defaultTraceFetcher;
  const modelCardClient = props.modelCardClient ?? defaultModelCardClient;

  const [searchParams, setSearchParams] = useSearchParams();
  const conversationTitleFromURL = (searchParams.get('conversationTitle') ?? '').trim();

  const {
    conversationData,
    loading,
    tracesLoading,
    errorMessage,
    tokenSummary,
    costSummary,
    generationCosts,
    modelCards,
    allGenerations,
  } = useConversationData({
    conversationID,
    dataSource,
    traceFetcher,
    modelCardClient,
  });

  const conversationTitleFromTelemetry = useMemo(
    () => resolveConversationTitleFromTelemetry(allGenerations, conversationData?.spans ?? []),
    [allGenerations, conversationData?.spans]
  );

  const conversationTitle =
    conversationData?.conversationTitle?.trim() || conversationTitleFromTelemetry || conversationTitleFromURL;
  const conversationUserId = useMemo(() => resolveConversationUserId(conversationData), [conversationData]);
  const [recentRatings, setRecentRatings] = useState<ConversationRating[]>([]);

  const {
    isSaved,
    loading: saveLoading,
    toggleSave,
  } = useSavedConversation(conversationID, conversationTitle || conversationID);

  const defaultSaveName = conversationTitle || conversationID;
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  useEffect(() => {
    if (!conversationID || !dataSource.listConversationRatings) {
      setRecentRatings([]);
      return;
    }

    let cancelled = false;
    void dataSource
      .listConversationRatings(conversationID, 5)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setRecentRatings(response.items ?? []);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setRecentRatings([]);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationID, dataSource]);

  const handleToggleSave = useCallback(() => {
    if (!isSaved) {
      setSaveName(defaultSaveName);
      setSaveModalOpen(true);
      return;
    }
    void toggleSave()
      .then((nowSaved) => {
        if (nowSaved === null) {
          return;
        }
        getAppEvents().publish({
          type: AppEvents.alertWarning.name,
          payload: ['Conversation unsaved'],
        });
      })
      .catch(() => {
        getAppEvents().publish({
          type: AppEvents.alertWarning.name,
          payload: ['Failed to update save status'],
        });
      });
  }, [isSaved, toggleSave, defaultSaveName]);

  const handleConfirmSave = useCallback(() => {
    setSaveModalOpen(false);
    // Pass undefined when blank so the fallback chain in toggleSave activates.
    void toggleSave(saveName.trim() || undefined)
      .then((nowSaved) => {
        if (nowSaved === null) {
          return;
        }
        getAppEvents().publish({
          type: AppEvents.alertSuccess.name,
          payload: ['Conversation saved'],
        });
      })
      .catch(() => {
        getAppEvents().publish({
          type: AppEvents.alertWarning.name,
          payload: ['Failed to save conversation'],
        });
      });
  }, [toggleSave, saveName]);

  const VALID_GROUP_BY = new Set<FlowGroupBy>(['none', 'agent', 'model', 'provider']);
  const VALID_SORT_BY = new Set<FlowSortBy>(['time', 'duration', 'tokens', 'cost']);

  const flowGroupByParam = searchParams.get('groupBy') as FlowGroupBy | null;
  const flowGroupBy: FlowGroupBy =
    flowGroupByParam && VALID_GROUP_BY.has(flowGroupByParam) ? flowGroupByParam : 'agent';
  const flowSortByParam = searchParams.get('sortBy') as FlowSortBy | null;
  const flowSortBy: FlowSortBy = flowSortByParam && VALID_SORT_BY.has(flowSortByParam) ? flowSortByParam : 'time';
  const flowSearchQuery = searchParams.get('search') ?? '';

  const setFlowGroupBy = useCallback(
    (value: FlowGroupBy) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === 'agent') {
            next.delete('groupBy');
          } else {
            next.set('groupBy', value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setFlowSortBy = useCallback(
    (value: FlowSortBy) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === 'time') {
            next.delete('sortBy');
          } else {
            next.set('sortBy', value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setFlowSearchQuery = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === '') {
            next.delete('search');
          } else {
            next.set('search', value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const flowOptions = useMemo(() => ({ groupBy: flowGroupBy, sortBy: flowSortBy }), [flowGroupBy, flowSortBy]);
  const { flowNodes, totalDurationMs } = useConversationFlow(
    conversationData,
    allGenerations,
    flowOptions,
    generationCosts
  );

  const selectedNodeId = searchParams.get('node');

  const MIN_PANEL_WIDTH = 260;
  const MAX_PANEL_WIDTH = 700;
  const MIN_TRACE_DRAWER_WIDTH = 420;
  const MAX_TRACE_DRAWER_WIDTH = 1200;
  const [panelWidth, setPanelWidth] = useState(340);
  const [traceDrawerWidth, setTraceDrawerWidth] = useState(720);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarCollapsedBeforeTraceRef = useRef(false);
  const traceDrawerOpenRef = useRef(false);
  const rightPanelContentRef = useRef<HTMLDivElement | null>(null);
  const pendingTraceDrawerAutosizeRef = useRef(false);
  const dragging = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startWidth = panelWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidth + delta));
        setPanelWidth(newWidth);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [panelWidth]
  );

  const handleTraceDrawerResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startWidth = traceDrawerWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.min(MAX_TRACE_DRAWER_WIDTH, Math.max(MIN_TRACE_DRAWER_WIDTH, startWidth - delta));
        setTraceDrawerWidth(newWidth);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [traceDrawerWidth]
  );

  const selectedNode = useMemo<FlowNode | null>(() => {
    if (selectedNodeId === null) {
      return null;
    }
    return findNodeById(flowNodes, selectedNodeId);
  }, [flowNodes, selectedNodeId]);
  const [traceOverlaySpan, setTraceOverlaySpan] = useState<ConversationSpan | null>(null);
  const traceOverlayTimeRange = useMemo<TimeRange | null>(() => {
    if (!traceOverlaySpan) {
      return null;
    }
    const startMs = Number(traceOverlaySpan.startTimeUnixNano / BigInt(1_000_000));
    const endMs = Number(traceOverlaySpan.endTimeUnixNano / BigInt(1_000_000));
    const paddingMs = 5 * 60 * 1000;
    const from = dateTime(Math.max(0, startMs - paddingMs));
    const to = dateTime(Math.max(startMs + 1, endMs + paddingMs));
    return { from, to, raw: { from: from.toISOString(), to: to.toISOString() } };
  }, [traceOverlaySpan]);

  const setSelectedNodeId = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) {
        next.set('node', id);
      } else {
        next.delete('node');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const [scrollToToolCallId, setScrollToToolCallId] = useState<string | null>(null);

  const handleSelectNode = useCallback(
    (node: FlowNode | null) => {
      if (node?.kind === 'tool_call' && node.parentNodeId) {
        setSelectedNodeId(node.parentNodeId);
        setScrollToToolCallId(node.toolCallId ?? null);
      } else {
        setSelectedNodeId(node?.id ?? null);
        setScrollToToolCallId(null);
      }
    },
    [setSelectedNodeId]
  );

  const handleDeselectNode = useCallback(() => {
    setSelectedNodeId(null);
    setScrollToToolCallId(null);
  }, [setSelectedNodeId]);

  const handleNavigateToGeneration = useCallback(
    (generationId: string) => {
      const node = findNodeByGenerationId(flowNodes, generationId);
      if (node) {
        setSelectedNodeId(node.id);
        setScrollToToolCallId(null);
      }
    },
    [flowNodes, setSelectedNodeId]
  );

  useEffect(() => {
    traceDrawerOpenRef.current = traceOverlaySpan != null;
  }, [traceOverlaySpan]);

  const handleOpenTraceDrawer = useCallback((span: ConversationSpan) => {
    setSidebarCollapsed((wasCollapsed) => {
      if (!traceDrawerOpenRef.current) {
        sidebarCollapsedBeforeTraceRef.current = wasCollapsed;
        traceDrawerOpenRef.current = true;
      }
      return true;
    });
    pendingTraceDrawerAutosizeRef.current = true;
    setTraceOverlaySpan(span);
  }, []);

  const handleCloseTraceDrawer = useCallback(() => {
    traceDrawerOpenRef.current = false;
    setTraceOverlaySpan(null);
    setSidebarCollapsed(sidebarCollapsedBeforeTraceRef.current);
  }, []);

  useEffect(() => {
    if (!traceOverlaySpan || !selectedNode?.span) {
      return;
    }

    if (
      traceOverlaySpan.traceID === selectedNode.span.traceID &&
      traceOverlaySpan.spanID === selectedNode.span.spanID
    ) {
      return;
    }

    setTraceOverlaySpan(selectedNode.span);
  }, [selectedNode, traceOverlaySpan]);

  useEffect(() => {
    if (!traceOverlaySpan || !sidebarCollapsed || !pendingTraceDrawerAutosizeRef.current) {
      return;
    }

    const resizeTraceDrawer = () => {
      const containerWidth = rightPanelContentRef.current?.clientWidth ?? 0;
      if (containerWidth <= 0) {
        return false;
      }

      const nextWidth = Math.min(
        MAX_TRACE_DRAWER_WIDTH,
        Math.max(MIN_TRACE_DRAWER_WIDTH, Math.round(containerWidth / 2))
      );
      setTraceDrawerWidth(nextWidth);
      pendingTraceDrawerAutosizeRef.current = false;
      return true;
    };

    if (resizeTraceDrawer()) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      resizeTraceDrawer();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [traceOverlaySpan, sidebarCollapsed]);

  const models = useMemo(
    () => Array.from(new Set(allGenerations.map((g) => g.model?.name).filter((n): n is string => Boolean(n)))),
    [allGenerations]
  );

  const modelProviders = useMemo(() => {
    const map: Record<string, string> = {};
    for (const gen of allGenerations) {
      if (gen.model?.name && gen.model?.provider) {
        map[gen.model.name] = gen.model.provider;
      }
    }
    return map;
  }, [allGenerations]);

  const errorCount = useMemo(() => allGenerations.filter((g) => Boolean(g.error?.message)).length, [allGenerations]);
  const callsByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const gen of allGenerations) {
      const agentName = gen.agent_name?.trim() || 'Unknown agent';
      counts.set(agentName, (counts.get(agentName) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([agent, count]) => ({ agent, count }))
      .sort((left, right) => right.count - left.count || left.agent.localeCompare(right.agent));
  }, [allGenerations]);

  const exploreInsightDataContext = useMemo(() => {
    if (loading || !conversationData) {
      return null;
    }
    const topCosts = [...generationCosts.entries()]
      .sort((a, b) => (b[1].breakdown.totalCost ?? 0) - (a[1].breakdown.totalCost ?? 0))
      .slice(0, 3)
      .map(([id, cost]) => `  ${id}: $${(cost.breakdown.totalCost ?? 0).toFixed(6)}`)
      .join('\n');
    return [
      `Conversation ID: ${conversationID}`,
      `Total duration: ${totalDurationMs}ms`,
      `Generation count: ${conversationData.generationCount}`,
      `Token summary: input=${tokenSummary?.inputTokens ?? 0}, output=${tokenSummary?.outputTokens ?? 0}, total=${tokenSummary?.totalTokens ?? 0}`,
      `Cost summary: $${(costSummary?.totalCost ?? 0).toFixed(6)}`,
      `Errors: ${errorCount}`,
      `Models: ${models.join(', ') || 'none'}`,
      topCosts.length > 0 ? `Top generations by cost:\n${topCosts}` : '',
    ]
      .filter((l) => l.length > 0)
      .join('\n');
  }, [
    loading,
    conversationData,
    conversationID,
    totalDurationMs,
    tokenSummary,
    costSummary,
    errorCount,
    models,
    generationCosts,
  ]);

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.spinnerWrap}>
          <Loader />
        </div>
      </div>
    );
  }

  if (errorMessage.length > 0) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.errorWrap}>
          <Alert severity="error" title="Failed to load conversation">
            {errorMessage}
          </Alert>
        </div>
      </div>
    );
  }

  if (!conversationData) {
    return null;
  }

  return (
    <div className={styles.pageContainer}>
      <Modal
        title="Save conversation"
        isOpen={saveModalOpen}
        onDismiss={() => setSaveModalOpen(false)}
        className={styles.saveModal}
      >
        <div className={styles.saveModalInput}>
          <Input
            value={saveName}
            placeholder={defaultSaveName}
            onChange={(e) => setSaveName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleConfirmSave();
              }
            }}
            autoFocus
          />
        </div>
        <Modal.ButtonRow>
          <Button variant="secondary" onClick={() => setSaveModalOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirmSave}>Save</Button>
        </Modal.ButtonRow>
      </Modal>
      <div className={styles.topSection}>
        <MetricsBar
          conversationID={conversationID}
          conversationTitle={conversationTitle}
          conversationUserId={conversationUserId}
          totalDurationMs={totalDurationMs}
          tokenSummary={tokenSummary}
          costSummary={costSummary}
          callsByAgent={callsByAgent}
          models={models}
          modelProviders={modelProviders}
          modelCards={modelCards}
          errorCount={errorCount}
          generationCount={conversationData.generationCount}
          ratingSummary={conversationData.ratingSummary}
          recentRatings={recentRatings}
          isSaved={isSaved}
          onToggleSave={saveLoading ? undefined : handleToggleSave}
          onBack={() => navigate(-1)}
        />
        <div className={styles.insightRow}>
          <PageInsightBar
            prompt="Analyze this single conversation trace. Flag expensive operations, errors, unusual patterns, or optimization opportunities."
            origin="sigil-plugin/conversation-explore-insight"
            dataContext={exploreInsightDataContext}
          />
        </div>
      </div>
      <div className={styles.contentArea}>
        {sidebarCollapsed ? (
          <div className={styles.collapsedRail}>
            <Tooltip content="Show sidebar" placement="right">
              <button
                type="button"
                className={styles.expandButton}
                onClick={() => setSidebarCollapsed(false)}
                aria-label="Expand sidebar"
              >
                <Icon name="angle-right" size="md" />
              </button>
            </Tooltip>
          </div>
        ) : (
          <>
            <div className={styles.leftPanel} style={{ width: panelWidth }}>
              <MiniTimeline
                nodes={flowNodes}
                totalDurationMs={totalDurationMs}
                selectedNodeId={selectedNodeId}
                onSelectNode={handleSelectNode}
                generationCosts={generationCosts}
                onCollapse={() => setSidebarCollapsed(true)}
              />
              <FlowTree
                nodes={flowNodes}
                loading={tracesLoading}
                selectedNodeId={selectedNodeId}
                onSelectNode={handleSelectNode}
                generationCosts={generationCosts}
                groupBy={flowGroupBy}
                onGroupByChange={setFlowGroupBy}
                sortBy={flowSortBy}
                onSortByChange={setFlowSortBy}
                searchQuery={flowSearchQuery}
                onSearchQueryChange={setFlowSearchQuery}
              />
            </div>
            <div
              className={styles.resizeHandle}
              onMouseDown={handleResizeStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize flow panel"
            />
          </>
        )}
        <div className={styles.rightPanel}>
          <div className={styles.rightPanelContent} ref={rightPanelContentRef}>
            <div className={styles.detailPanelWrap}>
              <DetailPanel
                selectedNode={selectedNode}
                allGenerations={allGenerations}
                flowNodes={flowNodes}
                generationCosts={generationCosts}
                onDeselectNode={handleDeselectNode}
                onNavigateToGeneration={handleNavigateToGeneration}
                scrollToToolCallId={scrollToToolCallId}
                onOpenTraceDrawer={handleOpenTraceDrawer}
                onCloseTraceDrawer={handleCloseTraceDrawer}
                isTraceDrawerOpen={traceOverlaySpan != null}
              />
            </div>
            {traceOverlaySpan && traceOverlayTimeRange && (
              <>
                <div
                  className={styles.resizeHandle}
                  onMouseDown={handleTraceDrawerResizeStart}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize trace drawer"
                />
                <div className={styles.traceDrawerPanel} style={{ width: traceDrawerWidth }}>
                  <div className={styles.traceDrawerHeader}>
                    <div className={styles.traceDrawerTitle}>
                      <Icon name="gf-traces" size="sm" />
                      Trace
                    </div>
                    <button
                      type="button"
                      className={styles.traceDrawerClose}
                      aria-label="Close trace drawer"
                      onClick={handleCloseTraceDrawer}
                    >
                      <Icon name="times" size="sm" />
                    </button>
                  </div>
                  <div className={styles.traceDrawerBody}>
                    <div className={styles.tracePanelHost}>
                      <GrafanaTracePanel
                        key={`${traceOverlaySpan.traceID}:${traceOverlaySpan.spanID}`}
                        traceId={traceOverlaySpan.traceID}
                        spanId={traceOverlaySpan.spanID}
                        timeRange={traceOverlayTimeRange}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function findNodeById(nodes: FlowNode[], id: string): FlowNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findNodeById(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}

function findNodeByGenerationId(nodes: FlowNode[], generationId: string): FlowNode | null {
  for (const node of nodes) {
    if (node.generation?.generation_id === generationId) {
      return node;
    }
    const found = findNodeByGenerationId(node.children, generationId);
    if (found) {
      return found;
    }
  }
  return null;
}
