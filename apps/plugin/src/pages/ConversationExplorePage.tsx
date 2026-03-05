import React, { useCallback, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, type GrafanaTheme2 } from '@grafana/data';
import { Alert, useStyles2 } from '@grafana/ui';
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
import {
  getHighlightedSidebarItems,
  type HighlightedSidebarItem,
} from '../components/conversation-explore/getHighlightedSidebarItems';
import { Loader } from '../components/Loader';
import AssistantInsightsList, { type AssistantInsightDisplayItem } from '../components/assistant/AssistantInsightsList';

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
  }),
  detailPanelWrap: css({
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  }),
  insightsWrap: css({
    width: 320,
    flexShrink: 0,
    minHeight: 0,
    background: theme.colors.background.primary,
  }),
});

type AssistantInsightItem = {
  itemId: string;
  focus: string;
};

export default function ConversationExplorePage(props: ConversationExplorePageProps) {
  const styles = useStyles2(getStyles);
  const { conversationID = '' } = useParams<{ conversationID?: string }>();

  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const traceFetcher = props.traceFetcher ?? defaultTraceFetcher;
  const modelCardClient = props.modelCardClient ?? defaultModelCardClient;

  const [searchParams, setSearchParams] = useSearchParams();
  const conversationTitle = searchParams.get('conversationTitle') ?? '';

  const { conversationData, loading, errorMessage, tokenSummary, costSummary, generationCosts, allGenerations } =
    useConversationData({
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

  const [flowGroupBy, setFlowGroupBy] = useState<FlowGroupBy>('agent');
  const [flowSortBy, setFlowSortBy] = useState<FlowSortBy>('time');
  const [flowSearchQuery, setFlowSearchQuery] = useState('');

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
  const totalTokensForInsights = useMemo(() => {
    if (tokenSummary) {
      return tokenSummary.totalTokens;
    }
    return allGenerations.reduce((sum, generation) => sum + (generation.usage?.total_tokens ?? 0), 0);
  }, [allGenerations, tokenSummary]);
  const totalCostUsdForInsights = useMemo(() => {
    if (costSummary) {
      return costSummary.totalCost;
    }
    let total = 0;
    for (const [, cost] of generationCosts) {
      total += cost.breakdown.totalCost;
    }
    return total;
  }, [costSummary, generationCosts]);
  const highlightedSidebarItems = useMemo(
    () => getHighlightedSidebarItems(flowNodes, generationCosts),
    [flowNodes, generationCosts]
  );

  const highlightedSidebarItemMap = useMemo(() => {
    const map = new Map<string, HighlightedSidebarItem>();
    for (const item of highlightedSidebarItems) {
      map.set(item.itemId, item);
    }
    return map;
  }, [highlightedSidebarItems]);

  const insightsDataContext = useMemo(() => {
    if (highlightedSidebarItems.length === 0) {
      return null;
    }
    const modelList = models.length > 0 ? models.join(', ') : 'unknown';
    const providerValues = Array.from(new Set(Object.values(modelProviders)));
    const providerList = providerValues.length > 0 ? providerValues.join(', ') : 'unknown';
    const lines: string[] = [
      'Conversation metadata:',
      `Conversation ID: ${conversationID}`,
      `First generation at (UTC): ${conversationData?.firstGenerationAt ?? 'unknown'}`,
      `Last generation at (UTC): ${conversationData?.lastGenerationAt ?? 'unknown'}`,
      `Generations: ${conversationData?.generationCount ?? allGenerations.length}`,
      `Models: ${modelList}`,
      `Providers: ${providerList}`,
      `Total duration (ms): ${Math.round(totalDurationMs)}`,
      `Total tokens: ${totalTokensForInsights}`,
      `Total cost USD: ${totalCostUsdForInsights.toFixed(6)}`,
      `Error count: ${errorCount}`,
      '',
      'Selectable sidebar items (use itemId exactly):',
    ];
    for (const item of highlightedSidebarItems) {
      lines.push(
        `- itemId=${item.itemId}; label=${item.label}; kind=${item.kind}; reasons=${item.reasons.join(',')}; durationMs=${Math.round(item.durationMs)}; tokenCount=${item.tokenCount}; costUsd=${item.costUsd.toFixed(6)}; status=${item.status}`
      );
    }
    return lines.join('\n');
  }, [
    allGenerations.length,
    conversationData?.generationCount,
    conversationData?.firstGenerationAt,
    conversationData?.lastGenerationAt,
    conversationID,
    errorCount,
    highlightedSidebarItems,
    modelProviders,
    models,
    totalCostUsdForInsights,
    totalDurationMs,
    totalTokensForInsights,
  ]);

  const parseAssistantDisplayItems = useCallback(
    (raw: string): AssistantInsightDisplayItem[] => {
      const items: AssistantInsightDisplayItem[] = [];
      for (const item of parseAssistantInsightItems(raw)) {
        const sidebarItem = highlightedSidebarItemMap.get(item.itemId);
        if (!sidebarItem) {
          continue;
        }
        items.push({
          itemId: item.itemId,
          sidebarLabel: sidebarItem.label,
          focus: item.focus,
        });
      }
      return items;
    },
    [highlightedSidebarItemMap]
  );

  const handleSelectInsightItem = useCallback(
    (itemId: string) => {
      const node = highlightedSidebarItemMap.get(itemId)?.node;
      if (!node) {
        return;
      }
      handleSelectNode(node);
    },
    [handleSelectNode, highlightedSidebarItemMap]
  );

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
        errorCount={errorCount}
        generationCount={conversationData.generationCount}
        isSaved={isSaved}
        onToggleSave={saveLoading ? undefined : handleToggleSave}
      />
      <div className={styles.contentArea}>
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
              />
            </div>
            <div className={styles.insightsWrap}>
              <AssistantInsightsList
                prompt="Review this conversation flow and suggest 3-5 high-confidence things to pay attention to. Prioritize anomalies. Use only selectable item IDs from the provided list."
                origin="sigil-plugin/conversation-explore-assistant-insights"
                systemPrompt='You are a concise GenAI observability analyst. Return JSON only, no markdown. Format exactly as: {"items":[{"itemId":"<exact item id>","focus":"<high-confidence suggestion on what to pay attention to>"}]}. Return 3-5 items. Include only high-confidence suggestions that are clearly supported by the provided data; omit uncertain suggestions. itemId must be one of the provided selectable IDs. Keep focus under 24 words.'
                dataContext={insightsDataContext}
                parseItems={parseAssistantDisplayItems}
                onSelectItem={handleSelectInsightItem}
                waitingText="Waiting for highlighted sidebar items."
                emptyText="Waiting for highlighted sidebar items."
                invalidText="Could not map assistant output to selectable sidebar items."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function parseAssistantInsightItems(raw: string): AssistantInsightItem[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] ?? trimmed;
  try {
    const parsed = JSON.parse(jsonText) as { items?: Array<Partial<AssistantInsightItem>> };
    if (!Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items
      .map((item) => ({
        itemId: (item.itemId ?? '').trim(),
        focus: (item.focus ?? '').trim(),
      }))
      .filter((item) => item.itemId.length > 0 && item.focus.length > 0);
  } catch {
    return [];
  }
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
