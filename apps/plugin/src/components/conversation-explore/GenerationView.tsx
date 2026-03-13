import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@emotion/css';
import { Button, Icon, Spinner, Toggletip, Tooltip, useStyles2 } from '@grafana/ui';
import { getDataSourceSrv } from '@grafana/runtime';
import {
  formatScoreValue,
  type GenerationDetail,
  type LatestScore,
  type Message,
  type Part,
  type ToolResultPart,
} from '../../generation/types';
import type { ConversationSpan, SpanAttributes } from '../../conversation/types';
import { getSelectionID } from '../../conversation/spans';
import { toNum } from '../../conversation/aggregates';
import { followupGeneration } from '../../conversation/api';
import { humanizeMessageRole } from '../../conversation/messageParser';
import { plugin } from '../../module';
import { buildAgentDetailHref } from '../dashboard/ViewAgentsLink';
import type { FlowNode } from './types';
import { getStyles } from './GenerationView.styles';
import { renderTextWithXml } from './CollapsibleXml';
import { parseToolContent } from './formatContent';
import { HighlightedJson } from './HighlightedJson';
import { TokenizedText } from '../tokenizer/TokenizedText';
import { useTokenizer } from '../tokenizer/useTokenizer';
import { getEncoding, AVAILABLE_ENCODINGS, type EncodingName } from '../tokenizer/encodingMap';
import { reconstructTurns, sortGenerationsByCreatedAt, type ConversationTurn } from './turns';

export type GenerationViewProps = {
  node: FlowNode;
  allGenerations: GenerationDetail[];
  flowNodes: FlowNode[];
  onClose: () => void;
  onNavigateToGeneration?: (generationId: string) => void;
  scrollToToolCallId?: string | null;
  onOpenTraceDrawer?: (span: ConversationSpan) => void;
  onCloseTraceDrawer?: () => void;
  isTraceDrawerOpen?: boolean;
};

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

const numberFmt = new Intl.NumberFormat('en-US');
const effectiveVersionPattern = /^sha256:[0-9a-f]{64}$/i;

function formatNumber(n: number): string {
  return numberFmt.format(n);
}

function resolveEffectiveVersion(generation: GenerationDetail): string {
  const candidates = [generation.agent_effective_version, generation.agent_version];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim() ?? '';
    if (trimmed.length === 0) {
      continue;
    }
    if (effectiveVersionPattern.test(trimmed)) {
      return trimmed.toLowerCase();
    }
  }
  return '';
}

function Section({
  title,
  count,
  defaultExpanded = true,
  headerExtra,
  tokenized,
  onToggleTokenize,
  autoEncoding,
  encodingOverride,
  onEncodingChange,
  tokenizerLoading,
  children,
}: {
  title: string;
  count?: string;
  defaultExpanded?: boolean;
  headerExtra?: React.ReactNode;
  tokenized?: boolean;
  onToggleTokenize?: () => void;
  autoEncoding?: EncodingName;
  encodingOverride?: EncodingName | null;
  onEncodingChange?: (encoding: EncodingName | null) => void;
  tokenizerLoading?: boolean;
  children: React.ReactNode;
}) {
  const styles = useStyles2(getStyles);
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader} onClick={() => setExpanded((p) => !p)}>
        <div className={styles.sectionHeaderTitle}>
          <Icon
            name="angle-right"
            size="sm"
            className={cx(styles.sectionChevron, expanded && styles.sectionChevronExpanded)}
          />
          {title}
          {count && <span className={styles.sectionCount}>({count})</span>}
        </div>
        {headerExtra && <div className={styles.sectionHeaderCenter}>{headerExtra}</div>}
        {onToggleTokenize && (
          <span className={styles.sectionHeaderActions}>
            <span
              className={cx(styles.tokenizeBtn, tokenized && styles.tokenizeBtnActive)}
              onClick={(e) => {
                e.stopPropagation();
                onToggleTokenize();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onToggleTokenize();
                }
              }}
              role="button"
              tabIndex={0}
            >
              <Icon name="brackets-curly" size="xs" />
              {tokenizerLoading ? 'Loading\u2026' : 'Tokenize'}
            </span>
            {tokenized && onEncodingChange && (
              <select
                className={styles.encodingSelect}
                aria-label="Tokenizer encoding"
                value={encodingOverride ?? ''}
                onChange={(e) => onEncodingChange(e.target.value ? (e.target.value as EncodingName) : null)}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="">Auto ({(autoEncoding ?? 'cl100k_base').replace('_base', '')})</option>
                {AVAILABLE_ENCODINGS.map((enc) => (
                  <option key={enc.value} value={enc.value}>
                    {enc.value.replace('_base', '')}
                  </option>
                ))}
              </select>
            )}
          </span>
        )}
      </div>
      {expanded && <div className={styles.sectionContent}>{children}</div>}
    </div>
  );
}

function isAiPillKey(key: string): boolean {
  return key.startsWith('gen_ai.') || key.startsWith('sigil.');
}

function AiAttributePills({ entries }: { entries: Array<{ key: string; value: string }> }) {
  const styles = useStyles2(getStyles);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={styles.pillsContainer}>
      {entries.map(({ key, value }) => (
        <span key={key} className={styles.aiAttributePill}>
          <span className={styles.aiAttributePillKey}>{key}</span>
          <span>{value}</span>
        </span>
      ))}
    </div>
  );
}

function AttributePills({ entries }: { entries: Array<{ key: string; value: string }> }) {
  const styles = useStyles2(getStyles);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={styles.pillsContainer}>
      {entries.map(({ key, value }) => (
        <span key={key} className={styles.attributePill}>
          <span className={styles.attributePillKey}>{key}</span>
          <span>{value}</span>
        </span>
      ))}
    </div>
  );
}

type ToolCallLink = {
  result?: ToolResultPart;
  resultGenerationId?: string;
  callGenerationId?: string;
};

function collectFlowNodeGenIds(nodes: FlowNode[]): Set<string> {
  const ids = new Set<string>();
  for (const n of nodes) {
    if (n.generation?.generation_id) {
      ids.add(n.generation.generation_id);
    }
    for (const id of collectFlowNodeGenIds(n.children)) {
      ids.add(id);
    }
  }
  return ids;
}

function buildToolCallLinks(allGenerations: GenerationDetail[], visibleGenIds: Set<string>): Map<string, ToolCallLink> {
  const map = new Map<string, ToolCallLink>();

  for (const g of allGenerations) {
    if (!visibleGenIds.has(g.generation_id)) {
      continue;
    }

    for (const msg of g.output ?? []) {
      for (const part of msg.parts) {
        if (part.tool_call) {
          const existing = map.get(part.tool_call.id);
          map.set(part.tool_call.id, { ...existing, callGenerationId: g.generation_id });
        }
      }
    }
    for (const msg of g.input ?? []) {
      for (const part of msg.parts) {
        if (part.tool_result) {
          const existing = map.get(part.tool_result.tool_call_id);
          map.set(part.tool_result.tool_call_id, {
            ...existing,
            result: part.tool_result,
            resultGenerationId: g.generation_id,
          });
        }
      }
    }
  }

  return map;
}

type ToolContext = {
  links: Map<string, ToolCallLink>;
  onNavigate?: (generationId: string) => void;
};

function GenJumpLink({ generationId, label, toolCtx }: { generationId: string; label: string; toolCtx: ToolContext }) {
  const styles = useStyles2(getStyles);
  if (!toolCtx.onNavigate) {
    return null;
  }

  return (
    <button type="button" className={styles.genJumpLink} onClick={() => toolCtx.onNavigate!(generationId)}>
      {label}
    </button>
  );
}

function MessageBlock({
  message,
  tokenized,
  encode,
  decode,
  toolCtx,
  turnIndex,
  totalTurns,
  emphasis = 'default',
}: {
  message: Message;
  tokenized?: boolean;
  encode?: (text: string) => number[];
  decode?: (ids: number[]) => string;
  toolCtx?: ToolContext;
  turnIndex?: number;
  totalTurns?: number;
  emphasis?: 'default' | 'history' | 'current';
}) {
  const styles = useStyles2(getStyles);

  const roleClass = cx(
    styles.messageRole,
    message.role === 'MESSAGE_ROLE_USER' && styles.messageRoleUser,
    message.role === 'MESSAGE_ROLE_ASSISTANT' && styles.messageRoleAssistant,
    message.role === 'MESSAGE_ROLE_TOOL' && styles.messageRoleTool
  );
  const turnLabel = turnIndex && totalTurns && totalTurns > 1 ? `Turn ${turnIndex} of ${totalTurns}` : undefined;

  return (
    <div
      className={cx(
        styles.messageBlock,
        emphasis === 'history' && styles.messageBlockHistory,
        emphasis === 'current' && styles.messageBlockCurrent
      )}
    >
      <div className={styles.messageHeader}>
        <div className={roleClass}>{humanizeMessageRole(message)}</div>
        {turnLabel && (
          <div
            className={cx(
              styles.messageTurn,
              emphasis === 'history' && styles.messageTurnHistory,
              emphasis === 'current' && styles.messageTurnCurrent
            )}
          >
            {turnLabel}
          </div>
        )}
      </div>
      {message.parts.map((part, i) => (
        <PartContent key={i} part={part} tokenized={tokenized} encode={encode} decode={decode} toolCtx={toolCtx} />
      ))}
    </div>
  );
}

function ToolResultInline({ result, toolCtx }: { result: ToolResultPart; toolCtx?: ToolContext }) {
  const styles = useStyles2(getStyles);
  const raw = result.content ?? result.content_json ?? '';
  const content = raw ? parseToolContent(raw) : null;
  const link = toolCtx?.links.get(result.tool_call_id);

  return (
    <>
      <div className={styles.toolResultSeparator} />
      <div className={styles.toolResultInlineHeader}>
        <div className={cx(styles.toolResultInlineLabel, result.is_error && styles.toolResultInlineError)}>
          {'↳ Result'}
          {result.is_error && ' (error)'}
        </div>
        {link?.resultGenerationId && toolCtx && (
          <GenJumpLink generationId={link.resultGenerationId} label="Jump to result →" toolCtx={toolCtx} />
        )}
      </div>
      {content?.kind === 'json' && <HighlightedJson content={content.formatted} />}
      {content?.kind === 'text' && <div className={styles.toolCallInlineArgs}>{content.content}</div>}
      {content?.kind === 'binary' && <div className={styles.toolCallInlineArgs}>{content.label}</div>}
    </>
  );
}

function PartContent({
  part,
  tokenized,
  encode,
  decode,
  toolCtx,
}: {
  part: Part;
  tokenized?: boolean;
  encode?: (text: string) => number[];
  decode?: (ids: number[]) => string;
  toolCtx?: ToolContext;
}) {
  const styles = useStyles2(getStyles);

  if (part.text) {
    if (tokenized && encode && decode) {
      return (
        <div className={styles.messageText}>
          <TokenizedText text={part.text} encode={encode} decode={decode} />
        </div>
      );
    }
    return <div className={styles.messageText}>{renderTextWithXml(part.text)}</div>;
  }

  if (part.thinking) {
    const thinkingText = part.thinking.length > 1000 ? `${part.thinking.slice(0, 1000)}...` : part.thinking;
    if (tokenized && encode && decode) {
      return (
        <div className={styles.messageText} style={{ fontStyle: 'italic', opacity: 0.7 }}>
          <TokenizedText text={thinkingText} encode={encode} decode={decode} />
        </div>
      );
    }
    return (
      <div className={styles.messageText} style={{ fontStyle: 'italic', opacity: 0.7 }}>
        {thinkingText}
      </div>
    );
  }

  if (part.tool_call) {
    const raw = part.tool_call.input_json ?? '';
    const content = raw ? parseToolContent(raw) : null;
    const link = toolCtx?.links.get(part.tool_call.id);
    return (
      <div data-tool-call-id={part.tool_call.id} className={styles.toolCallInline}>
        <div className={styles.toolCallInlineName}>{part.tool_call.name}</div>
        {content?.kind === 'json' && <HighlightedJson content={content.formatted} />}
        {content?.kind === 'text' && <div className={styles.toolCallInlineArgs}>{content.content}</div>}
        {content?.kind === 'binary' && <div className={styles.toolCallInlineArgs}>{content.label}</div>}
        {link?.result && <ToolResultInline result={link.result} toolCtx={toolCtx} />}
      </div>
    );
  }

  if (part.tool_result) {
    const raw = part.tool_result.content ?? part.tool_result.content_json ?? '';
    const content = raw ? parseToolContent(raw) : null;
    const link = toolCtx?.links.get(part.tool_result.tool_call_id);
    return (
      <div className={styles.toolCallInline}>
        <div className={styles.toolResultInlineHeader}>
          <div className={styles.toolCallInlineName}>
            {part.tool_result.name}
            {part.tool_result.is_error && ' (error)'}
          </div>
          {link?.callGenerationId && toolCtx && (
            <GenJumpLink generationId={link.callGenerationId} label="← Jump to call" toolCtx={toolCtx} />
          )}
        </div>
        {content?.kind === 'json' && <HighlightedJson content={content.formatted} />}
        {content?.kind === 'text' && <div className={styles.toolCallInlineArgs}>{content.content}</div>}
        {content?.kind === 'binary' && <div className={styles.toolCallInlineArgs}>{content.label}</div>}
      </div>
    );
  }

  return null;
}

function UsageChips({ generation }: { generation: GenerationDetail }) {
  const styles = useStyles2(getStyles);
  const u = generation.usage;
  if (!u) {
    return null;
  }

  const input = toNum(u.input_tokens);
  const output = toNum(u.output_tokens);
  const cacheRead = toNum(u.cache_read_input_tokens);
  const cacheWrite = toNum(u.cache_write_input_tokens);
  const totalIn = input + cacheRead + cacheWrite;
  const reasoning = toNum(u.reasoning_tokens);

  const hasCache = cacheRead > 0 || cacheWrite > 0;
  const newIn = input + cacheWrite;
  const cacheParts = hasCache
    ? [cacheRead > 0 ? `${formatNumber(cacheRead)} cached` : '', newIn > 0 ? `${formatNumber(newIn)} new` : ''].filter(
        Boolean
      )
    : [];
  const cacheDetail = cacheParts.length > 0 ? ` (${cacheParts.join(' + ')})` : '';

  return (
    <span className={styles.usageChips}>
      {`↓${formatNumber(totalIn)}`}
      {cacheDetail && <span className={styles.usageDim}>{cacheDetail}</span>}
      {`  ↑${formatNumber(output)}`}
      {reasoning > 0 && (
        <>
          <span className={styles.usageSep}>│</span>
          {`reasoning ${formatNumber(reasoning)}`}
        </>
      )}
    </span>
  );
}

function AgentContextLabel({ generation, fallbackModel }: { generation: GenerationDetail; fallbackModel?: string }) {
  const styles = useStyles2(getStyles);

  const agentName = generation.agent_name;
  const parts: string[] = [];
  if (agentName) {
    parts.push(agentName);
  }
  const label = parts.join(' · ');
  if (!label) {
    const model = generation.model?.name ?? fallbackModel;
    if (!model) {
      return null;
    }
    return <span className={styles.barMeta}>{model}</span>;
  }

  const tools = generation.tools ?? [];
  const systemPrompt = generation.system_prompt;
  const extraTags: string[] = [];
  if (generation.model?.provider) {
    extraTags.push(generation.model.provider);
  }
  if (generation.stop_reason) {
    extraTags.push(`stop: ${generation.stop_reason}`);
  }
  const hasExtra = extraTags.length > 0 || !!systemPrompt || tools.length > 0;

  if (!hasExtra) {
    return <span className={styles.agentLabel}>{label}</span>;
  }

  const content = (
    <div className={styles.tipContainer}>
      {extraTags.length > 0 && (
        <div className={styles.tipTagRow}>
          {extraTags.map((tag) => (
            <span key={tag} className={styles.tipTag}>
              {tag}
            </span>
          ))}
        </div>
      )}
      {systemPrompt && (
        <div className={styles.tipSection}>
          <div className={styles.tipSectionLabel}>System Prompt</div>
          <div className={styles.tipSystemPrompt}>
            {systemPrompt.length > 800 ? `${systemPrompt.slice(0, 800)}…` : systemPrompt}
          </div>
        </div>
      )}
      {tools.length > 0 && (
        <div className={styles.tipSection}>
          <div className={styles.tipSectionLabel}>Tools ({tools.length})</div>
          <div className={styles.toolList}>
            {tools.map((tool) => (
              <span key={tool.name} className={styles.toolChip}>
                {tool.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Toggletip placement="bottom" fitContent content={content}>
      <span className={styles.agentLabel} role="button" tabIndex={0} aria-label="Agent context">
        {label}
      </span>
    </Toggletip>
  );
}

function buildVersionedAgentHref(agentName: string, effectiveVersion?: string): string {
  const href = buildAgentDetailHref(agentName);
  if (!effectiveVersion) {
    return href;
  }
  const params = new URLSearchParams({ version: effectiveVersion });
  return `${href}?${params.toString()}`;
}

function AgentDetailButton({ generation }: { generation?: GenerationDetail }) {
  const styles = useStyles2(getStyles);
  const agentName = generation?.agent_name?.trim();

  if (!generation || !agentName) {
    return null;
  }

  const effectiveVersion = resolveEffectiveVersion(generation);
  const href = buildVersionedAgentHref(agentName, effectiveVersion);
  const label = effectiveVersion
    ? `Open agent page: ${agentName} (${effectiveVersion})`
    : `Open agent page: ${agentName}`;

  return (
    <Tooltip content={label} placement="top">
      <a href={href} className={styles.agentDetailButton} aria-label={label}>
        <Icon name="user" size="sm" />
      </a>
    </Tooltip>
  );
}

function collectAttributeEntries(attrs: SpanAttributes): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];

  for (const [key, val] of attrs) {
    if (key === 'user.id' || key === 'sigil.user.id') {
      continue;
    }
    if (val.stringValue !== undefined) {
      entries.push({ key, value: val.stringValue });
    } else if (val.intValue !== undefined) {
      entries.push({ key, value: val.intValue });
    } else if (val.doubleValue !== undefined) {
      entries.push({ key, value: String(val.doubleValue) });
    } else if (val.boolValue !== undefined) {
      entries.push({ key, value: String(val.boolValue) });
    }
  }

  return entries;
}

type AttributeTab = 'genai' | 'resource' | 'attributes';

function AttributeSections({ span }: { span: ConversationSpan }) {
  const styles = useStyles2(getStyles);
  const [selectedTab, setSelectedTab] = useState<AttributeTab>('genai');

  const resourceEntries = useMemo(() => collectAttributeEntries(span.resourceAttributes), [span.resourceAttributes]);
  const spanEntries = useMemo(() => collectAttributeEntries(span.attributes), [span.attributes]);

  const genAiEntries = useMemo(() => {
    const merged = new Map<string, { key: string; value: string }>();
    for (const entry of resourceEntries) {
      if (isAiPillKey(entry.key)) {
        merged.set(entry.key, entry);
      }
    }
    for (const entry of spanEntries) {
      if (isAiPillKey(entry.key)) {
        merged.set(entry.key, entry);
      }
    }
    return Array.from(merged.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [resourceEntries, spanEntries]);
  const plainResourceEntries = useMemo(
    () => resourceEntries.filter(({ key }) => !isAiPillKey(key)).sort((a, b) => a.key.localeCompare(b.key)),
    [resourceEntries]
  );
  const plainSpanEntries = useMemo(
    () => spanEntries.filter(({ key }) => !isAiPillKey(key)).sort((a, b) => a.key.localeCompare(b.key)),
    [spanEntries]
  );

  const tabs = [
    { id: 'genai', label: 'Gen AI', count: genAiEntries.length },
    { id: 'resource', label: 'Resource', count: plainResourceEntries.length },
    { id: 'attributes', label: 'Attributes', count: plainSpanEntries.length },
  ] satisfies Array<{ id: AttributeTab; label: string; count: number }>;
  const visibleTabs = tabs.filter((tab) => tab.count > 0);
  const activeTab = visibleTabs.some((tab) => tab.id === selectedTab) ? selectedTab : visibleTabs[0]?.id;

  if (visibleTabs.length === 0) {
    return null;
  }

  const activeEntries =
    activeTab === 'genai' ? genAiEntries : activeTab === 'resource' ? plainResourceEntries : plainSpanEntries;

  return (
    <div className={styles.attributeSections}>
      <div className={styles.attributeTabs} role="tablist" aria-label="Attribute groups">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={cx(styles.attributeTab, activeTab === tab.id && styles.attributeTabActive)}
            onClick={() => setSelectedTab(tab.id)}
          >
            {tab.label}
            <span className={styles.sectionCount}>({tab.count})</span>
          </button>
        ))}
      </div>
      {activeTab === 'genai' ? (
        <AiAttributePills entries={activeEntries} />
      ) : (
        <AttributePills entries={activeEntries} />
      )}
    </div>
  );
}

function resolveGeneration(node: FlowNode, allGenerations: GenerationDetail[]): GenerationDetail | undefined {
  if (node.generation) {
    return node.generation;
  }
  if (!node.span) {
    return undefined;
  }
  const { traceID, spanID } = node.span;

  // Strategy 1: exact trace_id + span_id match
  const bySpan = allGenerations.find((g) => g.trace_id === traceID && g.span_id === spanID);
  if (bySpan) {
    return bySpan;
  }

  // Strategy 2: match via sigil.generation.id attribute on the span
  const genIdAttr = node.span.attributes.get('sigil.generation.id');
  if (genIdAttr?.stringValue) {
    const byGenId = allGenerations.find((g) => g.generation_id === genIdAttr.stringValue);
    if (byGenId) {
      return byGenId;
    }
  }

  // Strategy 3: match by span_id only (trace IDs may differ between Tempo and API)
  const bySpanOnly = allGenerations.find((g) => g.span_id === spanID);
  if (bySpanOnly) {
    return bySpanOnly;
  }

  return undefined;
}

type AdjacentGenerations = {
  previous: GenerationDetail | undefined;
  next: GenerationDetail | undefined;
  currentIndex: number;
  total: number;
};

function findAdjacentGenerations(
  currentGen: GenerationDetail,
  allGenerations: GenerationDetail[]
): AdjacentGenerations {
  const sorted = sortGenerationsByCreatedAt(allGenerations);

  const idx = sorted.findIndex((g) => g.generation_id === currentGen.generation_id);
  return {
    previous: idx > 0 ? sorted[idx - 1] : undefined,
    next: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : undefined,
    currentIndex: idx,
    total: sorted.length,
  };
}

function formatTimeDelta(fromMs: number, toMs: number): string {
  const deltaMs = toMs - fromMs;
  const absSec = Math.abs(deltaMs) / 1000;
  const sign = deltaMs < 0 ? '-' : '+';
  if (absSec < 60) {
    return `${sign}${absSec.toFixed(1)}s`;
  }
  const min = Math.floor(absSec / 60);
  const sec = Math.round(absSec % 60);
  return `${sign}${min}m${sec > 0 ? `${sec}s` : ''}`;
}

function NavButton({
  direction,
  index,
  timeDelta,
  shortcut,
  onClick,
}: {
  direction: 'prev' | 'next';
  index: number;
  timeDelta: string | undefined;
  shortcut: string;
  onClick: () => void;
}) {
  const styles = useStyles2(getStyles);
  const label = timeDelta ? `#${index + 1} · ${timeDelta}` : `#${index + 1}`;
  const isPrev = direction === 'prev';

  return (
    <Tooltip content={`Press ${shortcut} to navigate`} placement="top">
      <div
        className={cx(styles.navButton, isPrev ? styles.navButtonPrev : styles.navButtonNext)}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onClick();
          }
        }}
      >
        {isPrev && <Icon name="arrow-left" size="sm" />}
        <kbd className={styles.kbd}>{shortcut}</kbd>
        <span className={styles.navButtonLabel}>{label}</span>
        {!isPrev && <Icon name="arrow-right" size="sm" />}
      </div>
    </Tooltip>
  );
}

function ScoreChips({ scores }: { scores: Record<string, LatestScore> }) {
  const styles = useStyles2(getStyles);

  const chips = useMemo(() => Object.entries(scores).sort(([a], [b]) => a.localeCompare(b)), [scores]);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className={styles.scoreChipsContainer}>
      {chips.map(([key, score]) => {
        const passed = score.passed;
        const chipClass =
          passed == null ? styles.scoreChipNeutral : passed ? styles.scoreChipPass : styles.scoreChipFail;

        const chipContent = (
          <>
            <span className={styles.scoreChipEvaluator}>{score.evaluator_id}</span>
            <span className={styles.scoreChipSep}>›</span>
            <span className={styles.scoreChipKey}>{key}:</span>
            <span className={styles.scoreChipValue}>{formatScoreValue(score.value)}</span>
            {passed != null && (
              <span className={passed ? styles.scoreChipPassIcon : styles.scoreChipFailIcon}>{passed ? '✓' : '✗'}</span>
            )}
          </>
        );

        if (!score.evaluator_description && !score.explanation) {
          return (
            <div key={key} className={`${styles.scoreChip} ${chipClass}`}>
              {chipContent}
            </div>
          );
        }

        return (
          <Tooltip
            key={key}
            content={
              <div>
                <div>
                  {score.evaluator_id} v{score.evaluator_version}
                </div>
                {score.evaluator_description && <div>{score.evaluator_description}</div>}
                {score.explanation && <div>{score.explanation}</div>}
              </div>
            }
            placement="top"
          >
            <div className={`${styles.scoreChip} ${chipClass}`}>{chipContent}</div>
          </Tooltip>
        );
      })}
    </div>
  );
}

type FollowupState = {
  input: string;
  loading: boolean;
  response: string | null;
  model: string | null;
  error: string | null;
};

const initialFollowupState: FollowupState = {
  input: '',
  loading: false,
  response: null,
  model: null,
  error: null,
};

function FollowupSection({
  conversationId,
  generationId,
}: {
  conversationId: string | undefined;
  generationId: string | undefined;
}) {
  const styles = useStyles2(getStyles);
  const [state, setState] = useState<FollowupState>(initialFollowupState);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset when generation changes
  const stableGenId = useRef(generationId);
  if (stableGenId.current !== generationId) {
    stableGenId.current = generationId;
    if (state !== initialFollowupState) {
      setState(initialFollowupState);
    }
  }

  const handleSubmit = useCallback(async () => {
    if (!conversationId || !generationId || !state.input.trim()) {
      return;
    }
    const requestGenId = generationId;
    setState((prev) => ({ ...prev, loading: true, error: null, response: null, model: null }));
    try {
      const resp = await followupGeneration(conversationId, {
        generation_id: generationId,
        message: state.input.trim(),
      });
      if (stableGenId.current !== requestGenId) {
        return;
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        response: resp.response,
        model: resp.model,
      }));
    } catch (err) {
      if (stableGenId.current !== requestGenId) {
        return;
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Request failed',
      }));
    }
  }, [conversationId, generationId, state.input]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  if (!conversationId || !generationId) {
    return null;
  }

  return (
    <div className={styles.followupSection}>
      <div className={styles.followupInputRow}>
        <textarea
          ref={textareaRef}
          className={styles.followupInput}
          placeholder="Ask about this step..."
          value={state.input}
          onChange={(e) => setState((prev) => ({ ...prev, input: e.target.value }))}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={state.loading}
        />
        <Button
          className={styles.followupButton}
          size="sm"
          onClick={handleSubmit}
          disabled={state.loading || !state.input.trim()}
        >
          {state.loading ? <Spinner size="sm" /> : 'Ask'}
        </Button>
      </div>
      {state.error && <div className={styles.followupError}>{state.error}</div>}
      {state.response && (
        <>
          <div className={styles.followupResponse}>{state.response}</div>
          {state.model && <div className={styles.followupMeta}>Answered by {state.model}</div>}
        </>
      )}
    </div>
  );
}

export default function GenerationView({
  node,
  allGenerations,
  flowNodes,
  onClose,
  onNavigateToGeneration,
  scrollToToolCallId,
  onOpenTraceDrawer,
  onCloseTraceDrawer,
  isTraceDrawerOpen = false,
}: GenerationViewProps) {
  const styles = useStyles2(getStyles);
  const gen = useMemo(() => resolveGeneration(node, allGenerations), [node, allGenerations]);
  const modelName = gen?.model?.name ?? node.model ?? undefined;
  const tempoLogoUrl = useMemo(() => {
    const tempoUid = (plugin.meta.jsonData as { tempoDatasourceUID?: string } | undefined)?.tempoDatasourceUID?.trim();
    if (!tempoUid) {
      return null;
    }
    return getDataSourceSrv().getInstanceSettings(tempoUid)?.meta?.info?.logos?.small ?? null;
  }, []);

  const visibleGenIds = useMemo(() => collectFlowNodeGenIds(flowNodes), [flowNodes]);
  const toolLinks = useMemo(() => buildToolCallLinks(allGenerations, visibleGenIds), [allGenerations, visibleGenIds]);
  const toolCtx: ToolContext = useMemo(
    () => ({ links: toolLinks, onNavigate: onNavigateToGeneration }),
    [toolLinks, onNavigateToGeneration]
  );
  const inputMessages = useMemo(() => gen?.input ?? [], [gen?.input]);
  const outputMessages = gen?.output ?? [];
  const u = gen?.usage;
  const inputSectionTokens = toNum(u?.input_tokens) + toNum(u?.cache_write_input_tokens);
  const outputTokens = toNum(u?.output_tokens);

  const adjacent = useMemo(
    () => (gen ? findAdjacentGenerations(gen, allGenerations) : undefined),
    [gen, allGenerations]
  );
  const turnHistory = useMemo(
    () =>
      gen ? reconstructTurns(inputMessages, gen, allGenerations) : { turns: [] as ConversationTurn[], totalTurns: 0 },
    [inputMessages, gen, allGenerations]
  );
  const { totalTurns } = turnHistory;
  const historyTurns = useMemo(() => turnHistory.turns.slice(0, -1), [turnHistory]);
  const currentTurn = turnHistory.turns.at(-1);

  const [revealedCount, setRevealedCount] = useState(0);
  const revealedGenRef = useRef(gen?.generation_id);
  if (revealedGenRef.current !== gen?.generation_id) {
    revealedGenRef.current = gen?.generation_id;
    if (revealedCount !== 0) {
      setRevealedCount(0);
    }
  }

  const clamped = Math.min(revealedCount, historyTurns.length);
  const visibleHistory = useMemo(() => historyTurns.slice(historyTurns.length - clamped), [historyTurns, clamped]);
  const remainingTurns = historyTurns.length - clamped;
  const showTurnContext = historyTurns.length > 0 || totalTurns > 1;

  const autoEncoding = useMemo(
    () => getEncoding(gen?.model?.provider, gen?.model?.name),
    [gen?.model?.provider, gen?.model?.name]
  );
  const genId = gen?.generation_id;
  const [tokenizeState, setTokenizeState] = useState<{
    genId: string | undefined;
    sections: Record<string, boolean>;
    encodingOverride: EncodingName | null;
  }>({ genId, sections: {}, encodingOverride: null });

  // Reset tokenize state when generation changes
  const tokenizedSections = tokenizeState.genId === genId ? tokenizeState.sections : {};
  const encodingOverride = tokenizeState.genId === genId ? tokenizeState.encodingOverride : null;

  const activeEncoding = encodingOverride ?? autoEncoding;
  const anyTokenized = Object.values(tokenizedSections).some(Boolean);
  const { encode, decode, isLoading: tokenizerLoading } = useTokenizer(anyTokenized ? activeEncoding : null);

  const setEncodingOverride = useCallback(
    (enc: EncodingName | null) => {
      setTokenizeState((prev) => ({
        genId,
        sections: prev.genId === genId ? prev.sections : {},
        encodingOverride: enc,
      }));
    },
    [genId]
  );

  const toggleSection = useCallback(
    (key: string) => {
      setTokenizeState((prev) => {
        const sections = prev.genId === genId ? prev.sections : {};
        return {
          genId,
          sections: { ...sections, [key]: !sections[key] },
          encodingOverride: prev.genId === genId ? prev.encodingOverride : null,
        };
      });
    },
    [genId]
  );

  const traceTargetSpan = node.span;
  const visibleAttributeCount = useMemo(() => {
    if (!node.span) {
      return 0;
    }
    const resourceEntries = collectAttributeEntries(node.span.resourceAttributes);
    const spanEntries = collectAttributeEntries(node.span.attributes);

    const aiKeys = new Set<string>();
    for (const e of resourceEntries) {
      if (isAiPillKey(e.key)) {
        aiKeys.add(e.key);
      }
    }
    for (const e of spanEntries) {
      if (isAiPillKey(e.key)) {
        aiKeys.add(e.key);
      }
    }

    return (
      aiKeys.size +
      resourceEntries.filter((e) => !isAiPillKey(e.key)).length +
      spanEntries.filter((e) => !isAiPillKey(e.key)).length
    );
  }, [node.span]);
  const hasAttributeSection = visibleAttributeCount > 0;

  const navigatePrev = useCallback(() => {
    if (adjacent?.previous) {
      onNavigateToGeneration?.(adjacent.previous.generation_id);
    }
  }, [adjacent, onNavigateToGeneration]);

  const navigateNext = useCallback(() => {
    if (adjacent?.next) {
      onNavigateToGeneration?.(adjacent.next.generation_id);
    }
  }, [adjacent, onNavigateToGeneration]);

  const toggleTraceDrawer = useCallback(() => {
    if (!traceTargetSpan) {
      return;
    }
    if (isTraceDrawerOpen) {
      onCloseTraceDrawer?.();
      return;
    }
    onOpenTraceDrawer?.(traceTargetSpan);
  }, [isTraceDrawerOpen, onCloseTraceDrawer, onOpenTraceDrawer, traceTargetSpan]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'a' && adjacent?.previous) {
        navigatePrev();
      } else if (key === 'd' && adjacent?.next) {
        navigateNext();
      } else if (key === 't' && traceTargetSpan) {
        toggleTraceDrawer();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [adjacent, navigatePrev, navigateNext, toggleTraceDrawer, traceTargetSpan]);

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollToToolCallId || !contentRef.current) {
      return;
    }
    const el = contentRef.current.querySelector(`[data-tool-call-id="${scrollToToolCallId}"]`);
    if (!el) {
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add(styles.toolCallHighlight);
      timer = setTimeout(() => el.classList.remove(styles.toolCallHighlight), 1500);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [scrollToToolCallId, styles.toolCallHighlight]);

  return (
    <div className={styles.container}>
      <div className={styles.stickyBar}>
        <div className={styles.navBar}>
          {adjacent?.previous ? (
            <NavButton
              direction="prev"
              index={adjacent.currentIndex - 1}
              timeDelta={
                gen?.created_at && adjacent.previous.created_at
                  ? formatTimeDelta(
                      new Date(gen.created_at).getTime(),
                      new Date(adjacent.previous.created_at).getTime()
                    )
                  : undefined
              }
              shortcut="A"
              onClick={navigatePrev}
            />
          ) : (
            <div />
          )}
          <div className={styles.navCenter}>
            {traceTargetSpan && (
              <Tooltip content="Open the trace drawer and focus the current span. Press T." placement="top">
                <button
                  type="button"
                  className={styles.traceAction}
                  aria-label={`Open trace drawer for span ${getSelectionID(traceTargetSpan)} (T)`}
                  onClick={toggleTraceDrawer}
                >
                  {tempoLogoUrl ? (
                    <img src={tempoLogoUrl} alt="" aria-hidden="true" className={styles.traceActionLogo} />
                  ) : (
                    <Icon name="gf-traces" size="sm" />
                  )}
                  <kbd className={styles.kbd}>T</kbd>
                </button>
              </Tooltip>
            )}
            {gen ? (
              <AgentContextLabel generation={gen} fallbackModel={modelName} />
            ) : (
              modelName && <span className={styles.barMeta}>{modelName}</span>
            )}
            <AgentDetailButton generation={gen} />
            {adjacent && (
              <span className={styles.barMeta}>
                {adjacent.currentIndex + 1}/{adjacent.total}
              </span>
            )}
          </div>
          {adjacent?.next ? (
            <NavButton
              direction="next"
              index={adjacent.currentIndex + 1}
              timeDelta={
                gen?.created_at && adjacent.next.created_at
                  ? formatTimeDelta(new Date(gen.created_at).getTime(), new Date(adjacent.next.created_at).getTime())
                  : undefined
              }
              shortcut="D"
              onClick={navigateNext}
            />
          ) : (
            <div />
          )}
        </div>
      </div>

      <div ref={contentRef} className={styles.content}>
        {gen?.error?.message && <div className={styles.errorBanner}>{gen.error.message}</div>}

        {!hasAttributeSection && (gen?.usage || modelName || node.durationMs > 0) && (
          <div className={styles.attributeSummaryRow}>
            {gen?.usage && <UsageChips generation={gen} />}
            {modelName && <span className={styles.attributeModeChip}>{modelName}</span>}
            <span className={styles.attributeModeChip}>{formatDuration(node.durationMs)}</span>
          </div>
        )}

        {hasAttributeSection && node.span && (
          <Section
            title="Attributes"
            count={visibleAttributeCount > 0 ? `${visibleAttributeCount}` : undefined}
            defaultExpanded={false}
            headerExtra={
              <div className={styles.attributeSummaryRow}>
                {gen?.usage && <UsageChips generation={gen} />}
                {modelName && <span className={styles.attributeModeChip}>{modelName}</span>}
                <span className={styles.attributeModeChip}>{formatDuration(node.durationMs)}</span>
              </div>
            }
          >
            <AttributeSections span={node.span} />
          </Section>
        )}

        {gen?.latest_scores && Object.keys(gen.latest_scores).length > 0 && (
          <Section title="Evaluations" count={String(Object.keys(gen.latest_scores).length)}>
            <ScoreChips scores={gen.latest_scores} />
          </Section>
        )}

        {currentTurn && currentTurn.messages.length > 0 && (
          <Section
            title="Input"
            count={inputSectionTokens > 0 ? `${formatNumber(inputSectionTokens)} tokens` : undefined}
            tokenized={tokenizedSections['input']}
            onToggleTokenize={() => toggleSection('input')}
            autoEncoding={autoEncoding}
            encodingOverride={encodingOverride}
            onEncodingChange={setEncodingOverride}
            tokenizerLoading={tokenizerLoading}
          >
            {historyTurns.length > 0 && (
              <div className={styles.historyControls}>
                {remainingTurns > 0 && (
                  <button type="button" className={styles.historyLink} onClick={() => setRevealedCount((c) => c + 1)}>
                    <Icon name="angle-up" size="sm" />
                    {remainingTurns === 1 ? 'Load 1 more turn' : `Load more (${remainingTurns} turns)`}
                  </button>
                )}
                {clamped > 0 && (
                  <button type="button" className={styles.historyLink} onClick={() => setRevealedCount(0)}>
                    Collapse
                  </button>
                )}
              </div>
            )}
            {visibleHistory.length > 0 && (
              <div className={cx(styles.historySection, styles.historySectionEarlier)}>
                {visibleHistory.map((turn) => (
                  <React.Fragment key={`turn-${turn.number}`}>
                    <div className={cx(styles.turnGroupSeparator, turn.prefixBreak && styles.turnGroupSeparatorBreak)}>
                      Turn {turn.number} of {totalTurns}
                      {turn.prefixBreak ? ' · context diverged' : ''}
                    </div>
                    <div className={styles.messageStack}>
                      {turn.messages.map((msg, mi) => (
                        <MessageBlock
                          key={`ctx-${turn.number}-${mi}`}
                          message={msg}
                          tokenized={tokenizedSections['input'] && !!encode}
                          encode={encode}
                          decode={decode}
                          toolCtx={toolCtx}
                          emphasis="history"
                        />
                      ))}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}
            {showTurnContext && visibleHistory.length > 0 && (
              <div className={styles.historySeparator}>Current prompt</div>
            )}
            <div className={cx(styles.historySection, showTurnContext && styles.historySectionCurrent)}>
              {showTurnContext && visibleHistory.length === 0 && (
                <div className={styles.historySectionLabel}>Current prompt</div>
              )}
              <div className={styles.messageStack}>
                {currentTurn.messages.map((msg, i) => (
                  <MessageBlock
                    key={i}
                    message={msg}
                    tokenized={tokenizedSections['input'] && !!encode}
                    encode={encode}
                    decode={decode}
                    toolCtx={toolCtx}
                    turnIndex={currentTurn.number}
                    totalTurns={totalTurns}
                    emphasis={showTurnContext ? 'current' : 'default'}
                  />
                ))}
              </div>
            </div>
          </Section>
        )}

        {outputMessages.length > 0 && (
          <Section
            title="Output"
            count={outputTokens > 0 ? `${formatNumber(outputTokens)} tokens` : undefined}
            tokenized={tokenizedSections['output']}
            onToggleTokenize={() => toggleSection('output')}
            autoEncoding={autoEncoding}
            encodingOverride={encodingOverride}
            onEncodingChange={setEncodingOverride}
            tokenizerLoading={tokenizerLoading}
          >
            {outputMessages.map((msg, i) => (
              <MessageBlock
                key={i}
                message={msg}
                tokenized={tokenizedSections['output'] && !!encode}
                encode={encode}
                decode={decode}
                toolCtx={toolCtx}
              />
            ))}
          </Section>
        )}

        <FollowupSection conversationId={gen?.conversation_id} generationId={gen?.generation_id} />
      </div>
    </div>
  );
}
