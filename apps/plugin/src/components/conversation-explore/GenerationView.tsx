import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@emotion/css';
import { Icon, Toggletip, Tooltip, useStyles2 } from '@grafana/ui';
import {
  formatScoreValue,
  type GenerationDetail,
  type LatestScore,
  type Message,
  type Part,
} from '../../generation/types';
import type { ConversationSpan } from '../../conversation/types';
import type { FlowNode } from './types';
import { getStyles } from './GenerationView.styles';
import { renderTextWithXml } from './CollapsibleXml';
import { formatToolContent } from './formatContent';
import { TokenizedText } from '../tokenizer/TokenizedText';
import { useTokenizer } from '../tokenizer/useTokenizer';
import { getEncoding, AVAILABLE_ENCODINGS, type EncodingName } from '../tokenizer/encodingMap';

export type GenerationViewProps = {
  node: FlowNode;
  allGenerations: GenerationDetail[];
  onClose: () => void;
  onNavigateToGeneration?: (generationId: string) => void;
  scrollToToolCallId?: string | null;
};

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

const numberFmt = new Intl.NumberFormat('en-US');
function formatNumber(n: number): string {
  return numberFmt.format(n);
}

function roleToLabel(role: string): string {
  switch (role) {
    case 'MESSAGE_ROLE_USER':
      return 'User';
    case 'MESSAGE_ROLE_ASSISTANT':
      return 'Assistant';
    case 'MESSAGE_ROLE_TOOL':
      return 'Tool';
    default:
      return role;
  }
}

function Section({
  title,
  count,
  defaultExpanded = true,
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
        <Icon
          name="angle-right"
          size="sm"
          className={cx(styles.sectionChevron, expanded && styles.sectionChevronExpanded)}
        />
        {title}
        {count && <span className={styles.sectionCount}>({count})</span>}
        {onToggleTokenize && (
          <span style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
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

function MessageBlock({
  message,
  tokenized,
  encode,
  decode,
}: {
  message: Message;
  tokenized?: boolean;
  encode?: (text: string) => number[];
  decode?: (ids: number[]) => string;
}) {
  const styles = useStyles2(getStyles);

  const roleClass = cx(
    styles.messageRole,
    message.role === 'MESSAGE_ROLE_USER' && styles.messageRoleUser,
    message.role === 'MESSAGE_ROLE_ASSISTANT' && styles.messageRoleAssistant,
    message.role === 'MESSAGE_ROLE_TOOL' && styles.messageRoleTool
  );

  return (
    <div className={styles.messageBlock}>
      <div className={roleClass}>{roleToLabel(message.role)}</div>
      {message.parts.map((part, i) => (
        <PartContent key={i} part={part} tokenized={tokenized} encode={encode} decode={decode} />
      ))}
    </div>
  );
}

function PartContent({
  part,
  tokenized,
  encode,
  decode,
}: {
  part: Part;
  tokenized?: boolean;
  encode?: (text: string) => number[];
  decode?: (ids: number[]) => string;
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
    const formattedArgs = part.tool_call.input_json ? formatToolContent(part.tool_call.input_json) : '';
    return (
      <div data-tool-call-id={part.tool_call.id} className={styles.toolCallInline}>
        <div className={styles.toolCallInlineName}>{part.tool_call.name}</div>
        {formattedArgs && <div className={styles.toolCallInlineArgs}>{formattedArgs}</div>}
      </div>
    );
  }

  if (part.tool_result) {
    const raw = part.tool_result.content ?? part.tool_result.content_json ?? '';
    const formatted = raw ? formatToolContent(raw) : '';
    return (
      <div className={styles.toolCallInline}>
        <div className={styles.toolCallInlineName}>
          {part.tool_result.name}
          {part.tool_result.is_error && ' (error)'}
        </div>
        {formatted && <div className={styles.toolCallInlineArgs}>{formatted}</div>}
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

  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheR = u.cache_read_input_tokens ?? 0;
  const cacheW = u.cache_write_input_tokens ?? 0;
  const reasoning = u.reasoning_tokens ?? 0;
  const hasCache = cacheR > 0 || cacheW > 0;

  return (
    <span className={styles.usageChips}>
      {`↓${formatNumber(input)}  ↑${formatNumber(output)}`}
      {hasCache && (
        <>
          <span className={styles.usageSep}>│</span>
          {`cache ↓${formatNumber(cacheR)}  ↑${formatNumber(cacheW)}`}
        </>
      )}
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
  const model = generation.model?.name ?? fallbackModel;
  const parts: string[] = [];
  if (agentName) {
    parts.push(agentName);
  }
  if (model && model !== agentName) {
    parts.push(model);
  }
  const label = parts.join(' · ');
  if (!label) {
    return null;
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
  const hasExtra = extraTags.length > 0 || systemPrompt || tools.length > 0;

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

function buildTracesDrilldownUrl(span: ConversationSpan, generationId: string): string {
  const url = new URL('/a/grafana-exploretraces-app/explore', window.location.origin);
  url.searchParams.set('from', 'now-30m');
  url.searchParams.set('to', 'now');
  url.searchParams.set('timezone', 'browser');
  url.searchParams.set('var-primarySignal', 'true');
  url.searchParams.set('var-filters', `span.sigil.generation.id|=|${generationId}`);
  url.searchParams.set('var-metric', 'rate');
  url.searchParams.set('var-groupBy', 'resource.service.name');
  url.searchParams.set('var-durationPercentiles', '0.9');
  url.searchParams.set('actionView', 'traceList');
  url.searchParams.set('traceId', span.traceID);
  url.searchParams.set('spanId', span.spanID);
  return url.pathname + url.search;
}

function SpanAttributesSection({ span, drilldownUrl }: { span: ConversationSpan; drilldownUrl: string | undefined }) {
  const styles = useStyles2(getStyles);
  const entries: Array<{ key: string; value: string }> = [];

  for (const [key, val] of span.attributes) {
    if (val.stringValue !== undefined) {
      entries.push({ key, value: val.stringValue });
    } else if (val.intValue !== undefined) {
      entries.push({ key, value: val.intValue });
    } else if (val.doubleValue !== undefined) {
      entries.push({ key, value: val.doubleValue });
    } else if (val.boolValue !== undefined) {
      entries.push({ key, value: String(val.boolValue) });
    }
  }

  if (entries.length === 0 && !drilldownUrl) {
    return null;
  }

  return (
    <div className={styles.attrGrid}>
      {drilldownUrl && (
        <a href={drilldownUrl} className={styles.drilldownLink}>
          <Icon name="external-link-alt" size="sm" />
          View in Traces Drilldown
        </a>
      )}
      {entries.map(({ key, value }) => (
        <div key={key} className={styles.attrItem}>
          <span className={styles.attrLabel}>{key}</span>
          <span className={styles.messageText} style={{ fontSize: 12 }}>
            {value}
          </span>
        </div>
      ))}
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
  const sorted = [...allGenerations].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return aTime - bTime;
  });

  const idx = sorted.findIndex((g) => g.generation_id === currentGen.generation_id);
  return {
    previous: idx > 0 ? sorted[idx - 1] : undefined,
    next: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : undefined,
    currentIndex: idx,
    total: sorted.length,
  };
}

function splitInputMessages(
  inputMessages: Message[],
  previousGen: GenerationDetail | undefined
): { contextCount: number; newMessages: Message[] } {
  if (!previousGen) {
    return { contextCount: 0, newMessages: inputMessages };
  }

  const prevCount = (previousGen.input?.length ?? 0) + (previousGen.output?.length ?? 0);
  if (prevCount <= 0 || prevCount >= inputMessages.length) {
    return { contextCount: 0, newMessages: inputMessages };
  }

  return {
    contextCount: prevCount,
    newMessages: inputMessages.slice(prevCount),
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

        return (
          <div key={key} className={`${styles.scoreChip} ${chipClass}`}>
            <span className={styles.scoreChipEvaluator}>{score.evaluator_id}</span>
            <span className={styles.scoreChipSep}>›</span>
            <span className={styles.scoreChipKey}>{key}:</span>
            <span className={styles.scoreChipValue}>{formatScoreValue(score.value)}</span>
            {passed != null && (
              <span className={passed ? styles.scoreChipPassIcon : styles.scoreChipFailIcon}>{passed ? '✓' : '✗'}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function GenerationView({
  node,
  allGenerations,
  onClose,
  onNavigateToGeneration,
  scrollToToolCallId,
}: GenerationViewProps) {
  const styles = useStyles2(getStyles);
  const gen = useMemo(() => resolveGeneration(node, allGenerations), [node, allGenerations]);
  const modelName = gen?.model?.name ?? node.model ?? undefined;

  const inputMessages = useMemo(() => gen?.input ?? [], [gen?.input]);
  const outputMessages = gen?.output ?? [];
  const inputTokens = gen?.usage?.input_tokens ?? 0;
  const outputTokens = gen?.usage?.output_tokens ?? 0;

  const adjacent = useMemo(
    () => (gen ? findAdjacentGenerations(gen, allGenerations) : undefined),
    [gen, allGenerations]
  );
  const { contextCount, newMessages } = useMemo(
    () => splitInputMessages(inputMessages, adjacent?.previous),
    [inputMessages, adjacent?.previous]
  );

  const displayedInput = contextCount > 0 ? newMessages : inputMessages;

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

  const tracesDrilldownUrl = useMemo(() => {
    if (!node.span) {
      return undefined;
    }
    const generationId = gen?.generation_id ?? node.span.attributes.get('sigil.generation.id')?.stringValue;
    if (!generationId) {
      return undefined;
    }
    return buildTracesDrilldownUrl(node.span, generationId);
  }, [node.span, gen?.generation_id]);

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
      if (e.key === 'a' && adjacent?.previous) {
        navigatePrev();
      } else if (e.key === 'd' && adjacent?.next) {
        navigateNext();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [adjacent, navigatePrev, navigateNext]);

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
            {gen ? (
              <AgentContextLabel generation={gen} fallbackModel={modelName} />
            ) : (
              modelName && <span className={styles.barMeta}>{modelName}</span>
            )}
            {gen?.usage && <UsageChips generation={gen} />}
            <span className={styles.barMeta}>{formatDuration(node.durationMs)}</span>
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

        {gen?.latest_scores && Object.keys(gen.latest_scores).length > 0 && (
          <Section title="Evaluations" count={String(Object.keys(gen.latest_scores).length)}>
            <ScoreChips scores={gen.latest_scores} />
          </Section>
        )}

        {gen?.system_prompt && (
          <Section
            title="System Prompt"
            tokenized={tokenizedSections['system']}
            onToggleTokenize={() => toggleSection('system')}
            autoEncoding={autoEncoding}
            encodingOverride={encodingOverride}
            onEncodingChange={setEncodingOverride}
            tokenizerLoading={tokenizerLoading}
          >
            {tokenizedSections['system'] && encode && decode ? (
              <TokenizedText text={gen.system_prompt} encode={encode} decode={decode} />
            ) : (
              <div className={styles.messageText}>{gen.system_prompt}</div>
            )}
          </Section>
        )}

        {displayedInput.length > 0 && (
          <Section
            title="Input"
            count={inputTokens > 0 ? `${formatNumber(inputTokens)} tokens` : undefined}
            tokenized={tokenizedSections['input']}
            onToggleTokenize={() => toggleSection('input')}
            autoEncoding={autoEncoding}
            encodingOverride={encodingOverride}
            onEncodingChange={setEncodingOverride}
            tokenizerLoading={tokenizerLoading}
          >
            {displayedInput.map((msg, i) => (
              <MessageBlock
                key={i}
                message={msg}
                tokenized={tokenizedSections['input'] && !!encode}
                encode={encode}
                decode={decode}
              />
            ))}
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
              />
            ))}
          </Section>
        )}

        {node.span && (
          <Section title="Span Attributes" count={String(node.span.attributes.size)} defaultExpanded={!gen}>
            <SpanAttributesSection span={node.span} drilldownUrl={tracesDrilldownUrl} />
          </Section>
        )}
      </div>
    </div>
  );
}
