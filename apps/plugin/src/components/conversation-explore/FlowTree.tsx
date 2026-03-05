import React, { useCallback, useMemo, useRef, useState } from 'react';
import { cx } from '@emotion/css';
import { Icon, Spinner, Tooltip, useStyles2 } from '@grafana/ui';
import type { GenerationCostResult } from '../../generation/types';
import type { FlowNode } from './types';
import type { FlowGroupBy, FlowSortBy } from './useConversationFlow';
import FlowNodeRow, { computeGenerationIndices, computeSiblingHighlights, type SiblingHighlights } from './FlowNodeRow';
import { getStyles } from './FlowTree.styles';

export type FlowTreeProps = {
  nodes: FlowNode[];
  loading?: boolean;
  selectedNodeId: string | null;
  onSelectNode: (node: FlowNode | null) => void;
  generationCosts?: Map<string, GenerationCostResult>;
  groupBy: FlowGroupBy;
  onGroupByChange: (value: FlowGroupBy) => void;
  sortBy: FlowSortBy;
  onSortByChange: (value: FlowSortBy) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
};

export type SearchScope = {
  messages: boolean;
  tools: boolean;
};

function messageTextMatches(node: FlowNode, query: string): boolean {
  const gen = node.generation;
  if (!gen) {
    return false;
  }
  const messages = [...(gen.input ?? []), ...(gen.output ?? [])];
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.text?.toLowerCase().includes(query)) {
        return true;
      }
    }
  }
  return false;
}

function toolContentMatches(node: FlowNode, query: string): boolean {
  const gen = node.generation;
  if (!gen) {
    return false;
  }
  const messages = [...(gen.input ?? []), ...(gen.output ?? [])];
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.tool_call?.name.toLowerCase().includes(query)) {
        return true;
      }
      if (part.tool_result?.name.toLowerCase().includes(query)) {
        return true;
      }
      if (part.tool_result?.content?.toLowerCase().includes(query)) {
        return true;
      }
    }
  }
  return false;
}

function nodeMatchesSearch(node: FlowNode, query: string, scope: SearchScope): boolean {
  if (node.label.toLowerCase().includes(query)) {
    return true;
  }
  if (scope.messages && messageTextMatches(node, query)) {
    return true;
  }
  if (scope.tools && toolContentMatches(node, query)) {
    return true;
  }
  return node.children.some((child) => nodeMatchesSearch(child, query, scope));
}

function filterNodes(nodes: FlowNode[], query: string, scope: SearchScope): FlowNode[] {
  if (!query) {
    return nodes;
  }
  const result: FlowNode[] = [];
  for (const node of nodes) {
    if (nodeMatchesSearch(node, query, scope)) {
      const filteredChildren = filterNodes(node.children, query, scope);
      result.push({ ...node, children: filteredChildren });
    }
  }
  return result;
}

const GROUP_BY_OPTIONS: Array<{ value: FlowGroupBy; label: string }> = [
  { value: 'none', label: '—' },
  { value: 'agent', label: 'Agent' },
  { value: 'model', label: 'Model' },
  { value: 'provider', label: 'Provider' },
];

const SORT_BY_OPTIONS: Array<{ value: FlowSortBy; label: string }> = [
  { value: 'time', label: 'Time' },
  { value: 'duration', label: 'Dur' },
  { value: 'tokens', label: 'Tok' },
  { value: 'cost', label: 'Cost' },
];

function PillGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.pillGroup} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={cx(styles.pill, opt.value === value && styles.pillActive)}
          onClick={() => onChange(opt.value)}
          role="radio"
          aria-checked={opt.value === value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function flattenGenerations(nodes: FlowNode[]): FlowNode[] {
  const result: FlowNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'generation') {
      result.push(node);
    }
    if (node.children.length > 0) {
      result.push(...flattenGenerations(node.children));
    }
  }
  return result;
}

function computeGlobalHighlights(nodes: FlowNode[], costs?: Map<string, GenerationCostResult>): SiblingHighlights {
  const allGenerations = flattenGenerations(nodes);
  return computeSiblingHighlights(allGenerations, costs);
}

export default function FlowTree({
  nodes,
  loading = false,
  selectedNodeId,
  onSelectNode,
  generationCosts,
  groupBy,
  onGroupByChange,
  sortBy,
  onSortByChange,
  searchQuery,
  onSearchQueryChange,
}: FlowTreeProps) {
  const styles = useStyles2(getStyles);
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchScope, setSearchScope] = useState<SearchScope>({ messages: false, tools: false });

  const normalizedQuery = useMemo(() => searchQuery.toLowerCase().trim(), [searchQuery]);

  const filteredNodes = useMemo(
    () => filterNodes(nodes, normalizedQuery, searchScope),
    [nodes, normalizedQuery, searchScope]
  );

  const genIndices = useMemo(() => computeGenerationIndices(filteredNodes), [filteredNodes]);
  const highlights = useMemo(
    () => computeGlobalHighlights(filteredNodes, generationCosts),
    [filteredNodes, generationCosts]
  );

  const clearSearch = useCallback(() => {
    onSearchQueryChange('');
    inputRef.current?.focus();
  }, [onSearchQueryChange]);

  const toggleMessages = useCallback(() => {
    setSearchScope((prev) => ({ ...prev, messages: !prev.messages }));
  }, []);

  const toggleTools = useCallback(() => {
    setSearchScope((prev) => ({ ...prev, tools: !prev.tools }));
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Flow</span>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.toolbarRow}>
          <span className={styles.toolbarLabel}>Group</span>
          <PillGroup options={GROUP_BY_OPTIONS} value={groupBy} onChange={onGroupByChange} ariaLabel="Group by" />
        </div>
        <div className={styles.toolbarRow}>
          <span className={styles.toolbarLabel}>Sort</span>
          <PillGroup options={SORT_BY_OPTIONS} value={sortBy} onChange={onSortByChange} ariaLabel="Sort by" />
        </div>
        <div className={styles.searchWrap}>
          <Icon name="search" size="sm" className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="text"
            placeholder="Filter..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            aria-label="Filter flow nodes"
          />
          <div className={styles.searchToggles}>
            <Tooltip content="Search in messages" placement="top">
              <button
                type="button"
                className={cx(styles.searchToggle, searchScope.messages && styles.searchToggleActive)}
                onClick={toggleMessages}
                aria-label="Search in messages"
                aria-pressed={searchScope.messages}
              >
                Aa
              </button>
            </Tooltip>
            <Tooltip content="Search in tool calls" placement="top">
              <button
                type="button"
                className={cx(styles.searchToggle, searchScope.tools && styles.searchToggleActive)}
                onClick={toggleTools}
                aria-label="Search in tool calls"
                aria-pressed={searchScope.tools}
              >
                <Icon name="brackets-curly" size="sm" />
              </button>
            </Tooltip>
            {searchQuery && (
              <button type="button" className={styles.searchToggle} onClick={clearSearch} aria-label="Clear filter">
                <Icon name="times" size="sm" />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className={styles.treeContainer} role="tree" aria-label="conversation flow">
        {loading && nodes.length === 0 ? (
          <div className={styles.emptyState}>
            <Spinner inline size="sm" /> Loading traces…
          </div>
        ) : filteredNodes.length === 0 ? (
          <div className={styles.emptyState}>{nodes.length === 0 ? 'No operations found' : 'No matches'}</div>
        ) : (
          filteredNodes.map((node, i) => (
            <FlowNodeRow
              key={node.id}
              node={node}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              generationIndex={genIndices[i]}
              generationCosts={generationCosts}
              siblingHighlights={highlights}
              searchQuery={normalizedQuery}
            />
          ))
        )}
      </div>
    </div>
  );
}
