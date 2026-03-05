import React, { useCallback, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, type GrafanaTheme2 } from '@grafana/data';
import { Alert, Icon, useStyles2 } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import { useParams, useSearchParams } from 'react-router-dom';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import { createTempoTraceFetcher } from '../conversation/fetchTrace';
import type { TraceFetcher } from '../conversation/loader';
import { defaultModelCardClient, type ModelCardClient } from '../modelcard/api';
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
import type { AgentContextDrawerPayload } from '../components/conversation-explore/GenerationView';
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
    padding: theme.spacing(0, 1.5),
    flexShrink: 0,
  }),
  contentArea: css({
    position: 'relative' as const,
    flex: 1,
    display: 'flex',
    flexDirection: 'row' as const,
    minHeight: 0,
    overflow: 'hidden',
  }),
  leftPanelToggle: css({
    position: 'absolute' as const,
    top: theme.spacing(1),
    width: 24,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${theme.colors.border.weak}`,
    borderLeft: 'none',
    borderRadius: `0 ${theme.shape.radius.default}px ${theme.shape.radius.default}px 0`,
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    zIndex: 6,
    transition: 'left 140ms ease, color 120ms ease, background 120ms ease',
    '&:hover': {
      color: theme.colors.text.primary,
      background: theme.colors.action.hover,
    },
  }),
  leftPanelToggleCollapsed: css({
    left: 0,
  }),
  leftPanel: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flexShrink: 0,
    background: theme.colors.background.primary,
    overflow: 'hidden',
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
    position: 'relative' as const,
    flex: 1,
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  }),
  detailPanelWrap: css({
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  }),
  agentDrawer: css({
    flex: '0 0 380px',
    width: 380,
    minWidth: 280,
    maxWidth: '45%',
    display: 'flex',
    flexDirection: 'column' as const,
    background: theme.colors.background.primary,
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    overflow: 'hidden',
  }),
  agentDrawerHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: `${theme.spacing(1.25)} ${theme.spacing(1.5)}`,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
  }),
  agentDrawerTitleWrap: css({
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.25),
  }),
  agentDrawerTitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    color: theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  agentDrawerSubtitle: css({
    fontSize: theme.typography.h5.fontSize,
    lineHeight: 1.3,
    color: theme.colors.text.primary,
    wordBreak: 'break-word' as const,
  }),
  agentDrawerClose: css({
    width: 28,
    height: 28,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    color: theme.colors.text.secondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    '&:hover': {
      color: theme.colors.text.primary,
      background: theme.colors.action.hover,
    },
  }),
  agentDrawerBody: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    overflowY: 'auto' as const,
  }),
  agentDrawerTagRow: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
  }),
  agentDrawerTag: css({
    display: 'inline-flex',
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    fontSize: 11,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  agentDrawerSection: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.75),
  }),
  agentDrawerSectionLabel: css({
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    color: theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  agentDrawerPrompt: css({
    margin: 0,
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.5,
    color: theme.colors.text.primary,
    maxHeight: 220,
    overflowY: 'auto' as const,
  }),
  agentDrawerToolList: css({
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: theme.spacing(0.5),
  }),
  agentDrawerToolChip: css({
    display: 'inline-flex',
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: 11,
  }),
  agentDrawerLink: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    width: 'fit-content',
    color: theme.colors.text.link,
    textDecoration: 'none',
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': {
      color: theme.colors.text.primary,
      textDecoration: 'underline',
    },
  }),
  agentDrawerEmpty: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
});

export default function ConversationExplorePage(props: ConversationExplorePageProps) {
  const styles = useStyles2(getStyles);
  const { conversationID = '' } = useParams<{ conversationID?: string }>();

  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const traceFetcher = props.traceFetcher ?? defaultTraceFetcher;
  const modelCardClient = props.modelCardClient ?? defaultModelCardClient;

  const [searchParams, setSearchParams] = useSearchParams();
  const conversationTitle = searchParams.get('conversationTitle') ?? '';

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

  const {
    isSaved,
    loading: saveLoading,
    toggleSave,
  } = useSavedConversation(conversationID, conversationTitle || conversationID);

  const handleToggleSave = useCallback(() => {
    void toggleSave()
      .then((nowSaved) => {
        if (nowSaved === null) {
          return;
        }
        getAppEvents().publish({
          type: AppEvents.alertSuccess.name,
          payload: [nowSaved ? 'Conversation saved' : 'Conversation unsaved'],
        });
      })
      .catch(() => {
        getAppEvents().publish({
          type: AppEvents.alertWarning.name,
          payload: ['Failed to update save status'],
        });
      });
  }, [toggleSave]);

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
  const [panelWidth, setPanelWidth] = useState(340);
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
  const dragging = useRef(false);
  const [agentContextDrawer, setAgentContextDrawer] = useState<AgentContextDrawerPayload | null>(null);

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

  const toggleLeftPanel = useCallback(() => {
    setIsLeftPanelCollapsed((prev) => !prev);
  }, []);

  const selectedNode = useMemo<FlowNode | null>(() => {
    if (selectedNodeId === null) {
      return null;
    }
    return findNodeById(flowNodes, selectedNodeId);
  }, [flowNodes, selectedNodeId]);

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

  const handleOpenAgentContext = useCallback((context: AgentContextDrawerPayload) => {
    setAgentContextDrawer(context);
  }, []);

  const handleCloseAgentContext = useCallback(() => {
    setAgentContextDrawer(null);
  }, []);
  const visibleAgentContextDrawer =
    selectedNode == null || selectedNode.kind === 'agent' ? null : agentContextDrawer;

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
      <MetricsBar
        conversationID={conversationID}
        totalDurationMs={totalDurationMs}
        tokenSummary={tokenSummary}
        costSummary={costSummary}
        models={models}
        modelProviders={modelProviders}
        modelCards={modelCards}
        errorCount={errorCount}
        generationCount={conversationData.generationCount}
        isSaved={isSaved}
        onToggleSave={saveLoading ? undefined : handleToggleSave}
      />
      <div className={styles.insightRow}>
        <PageInsightBar
          prompt="Analyze this single conversation trace. Flag expensive operations, errors, unusual patterns, or optimization opportunities."
          origin="sigil-plugin/conversation-explore-insight"
          dataContext={exploreInsightDataContext}
        />
      </div>
      <div className={styles.contentArea}>
        <button
          type="button"
          className={`${styles.leftPanelToggle} ${isLeftPanelCollapsed ? styles.leftPanelToggleCollapsed : ''}`}
          style={{ left: isLeftPanelCollapsed ? 0 : panelWidth + 4 }}
          aria-label={isLeftPanelCollapsed ? 'Expand flow panel' : 'Collapse flow panel'}
          aria-expanded={!isLeftPanelCollapsed}
          onClick={toggleLeftPanel}
        >
          <Icon name={isLeftPanelCollapsed ? 'angle-right' : 'angle-left'} size="sm" />
        </button>
        {!isLeftPanelCollapsed && (
          <div className={styles.leftPanel} style={{ width: panelWidth }}>
            <MiniTimeline
              nodes={flowNodes}
              totalDurationMs={totalDurationMs}
              selectedNodeId={selectedNodeId}
              onSelectNode={handleSelectNode}
              generationCosts={generationCosts}
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
        )}
        {!isLeftPanelCollapsed && (
          <div
            className={styles.resizeHandle}
            onMouseDown={handleResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize flow panel"
          />
        )}
        <div className={styles.rightPanel}>
          <div className={styles.rightPanelContent}>
            <div className={styles.detailPanelWrap}>
              <DetailPanel
                selectedNode={selectedNode}
                allGenerations={allGenerations}
                flowNodes={flowNodes}
                generationCosts={generationCosts}
                onDeselectNode={handleDeselectNode}
                onNavigateToGeneration={handleNavigateToGeneration}
                scrollToToolCallId={scrollToToolCallId}
                onOpenAgentContext={handleOpenAgentContext}
              />
            </div>
            {visibleAgentContextDrawer && (
              <div className={styles.agentDrawer} role="dialog" aria-label="Agent context drawer">
                <div className={styles.agentDrawerHeader}>
                  <div className={styles.agentDrawerTitleWrap}>
                    <div className={styles.agentDrawerTitle}>Agent Context</div>
                    <div className={styles.agentDrawerSubtitle}>{visibleAgentContextDrawer.label}</div>
                  </div>
                  <button
                    type="button"
                    className={styles.agentDrawerClose}
                    aria-label="Close agent drawer"
                    onClick={handleCloseAgentContext}
                  >
                    <Icon name="times" size="sm" />
                  </button>
                </div>
                <div className={styles.agentDrawerBody}>
                  {visibleAgentContextDrawer.extraTags.length > 0 && (
                    <div className={styles.agentDrawerTagRow}>
                      {visibleAgentContextDrawer.extraTags.map((tag) => (
                        <span key={tag} className={styles.agentDrawerTag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {visibleAgentContextDrawer.systemPrompt && (
                    <div className={styles.agentDrawerSection}>
                      <div className={styles.agentDrawerSectionLabel}>System Prompt</div>
                      <pre className={styles.agentDrawerPrompt}>
                        {visibleAgentContextDrawer.systemPrompt.length > 1200
                          ? `${visibleAgentContextDrawer.systemPrompt.slice(0, 1200)}…`
                          : visibleAgentContextDrawer.systemPrompt}
                      </pre>
                    </div>
                  )}

                  <div className={styles.agentDrawerSection}>
                    <div className={styles.agentDrawerSectionLabel}>Tools ({visibleAgentContextDrawer.tools.length})</div>
                    {visibleAgentContextDrawer.tools.length > 0 ? (
                      <div className={styles.agentDrawerToolList}>
                        {visibleAgentContextDrawer.tools.map((tool) => (
                          <span key={tool.name} className={styles.agentDrawerToolChip}>
                            {tool.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.agentDrawerEmpty}>No tools recorded for this generation.</div>
                    )}
                  </div>

                  {visibleAgentContextDrawer.agentDetailUrl && (
                    <a href={visibleAgentContextDrawer.agentDetailUrl} className={styles.agentDrawerLink}>
                      <Icon name="external-link-alt" size="sm" />
                      Open agent page
                    </a>
                  )}
                </div>
              </div>
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
