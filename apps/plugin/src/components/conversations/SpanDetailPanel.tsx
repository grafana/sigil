import React, { useState, useMemo } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { ConversationSpan, SpanAttributes, SpanAttributeValue } from '../../conversation/types';
import type { GenerationDetail, Message, Part } from '../../generation/types';
import { ATTR_GENERATION_ID, getStringAttr } from '../../conversation/attributes';

export type SpanDetailPanelProps = {
  span: ConversationSpan;
  allGenerations?: GenerationDetail[];
};

const NS_PER_MS = BigInt(1_000_000);
const NS_PER_SECOND = BigInt(1_000_000_000);

function formatNsDuration(durationNano: bigint): string {
  if (durationNano >= NS_PER_SECOND) {
    return `${(Number(durationNano) / Number(NS_PER_SECOND)).toFixed(3)} s`;
  }
  if (durationNano >= NS_PER_MS) {
    return `${(Number(durationNano) / Number(NS_PER_MS)).toFixed(2)} ms`;
  }
  return `${Number(durationNano)} ns`;
}

function formatNsTimestamp(ns: bigint): string {
  if (ns <= BigInt(0)) {
    return 'unknown';
  }
  return new Date(Number(ns / NS_PER_MS)).toISOString();
}

function formatAttrValue(value: SpanAttributeValue): string {
  if (value.stringValue !== undefined) {
    return value.stringValue;
  }
  if (value.intValue !== undefined) {
    return value.intValue;
  }
  if (value.doubleValue !== undefined) {
    return value.doubleValue;
  }
  if (value.boolValue !== undefined) {
    return String(value.boolValue);
  }
  if (value.arrayValue?.values) {
    return value.arrayValue.values.map(formatAttrValue).join(', ');
  }
  return '';
}

function sortedAttrs(attrs: SpanAttributes): Array<[string, SpanAttributeValue]> {
  return Array.from(attrs.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function partToText(part: Part): string {
  if (part.text) {
    return part.text;
  }
  if (part.thinking) {
    return `[thinking] ${part.thinking}`;
  }
  if (part.tool_call) {
    const input = part.tool_call.input_json ?? '';
    return `[tool_call: ${part.tool_call.name}] ${input}`;
  }
  if (part.tool_result) {
    const body = part.tool_result.content ?? part.tool_result.content_json ?? '';
    return `[tool_result: ${part.tool_result.name}] ${body}`;
  }
  return '';
}

function messageToText(msg: Message): string {
  return msg.parts.map(partToText).join('\n');
}

function getUsageValue(usage: GenerationDetail['usage'], key: keyof NonNullable<GenerationDetail['usage']>): string {
  const value = usage?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toLocaleString();
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
    height: '100%',
    overflow: 'auto',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  section: css({
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    '&:last-child': { borderBottom: 'none' },
  }),
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(0.75, 1),
    cursor: 'pointer',
    userSelect: 'none' as const,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    background: theme.colors.background.secondary,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  sectionChevron: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: '10px',
    color: theme.colors.text.secondary,
    transition: 'transform 0.15s ease',
  }),
  sectionChevronOpen: css({
    transform: 'rotate(90deg)',
  }),
  sectionBody: css({
    padding: theme.spacing(0.5, 1),
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(130px, 180px) minmax(0, 1fr)',
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.25, 0),
    alignItems: 'baseline',
  }),
  label: css({
    color: theme.colors.text.secondary,
    wordBreak: 'break-word' as const,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: '11px',
  }),
  value: css({
    color: theme.colors.text.primary,
    wordBreak: 'break-word' as const,
    overflowWrap: 'anywhere' as const,
  }),
  monospace: css({
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  messageBlock: css({
    marginBottom: theme.spacing(0.75),
  }),
  messageRole: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(0.25),
    textTransform: 'capitalize' as const,
  }),
  messageContent: css({
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    overflowWrap: 'anywhere' as const,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0.5, 0.75),
    maxHeight: 300,
    overflow: 'auto',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: '11px',
  }),
  toolName: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    color: theme.colors.text.secondary,
    fontSize: '11px',
  }),
  errorValue: css({
    color: theme.colors.error.text,
  }),
  emptyHint: css({
    color: theme.colors.text.disabled,
    fontStyle: 'italic' as const,
    padding: theme.spacing(0.25, 0),
  }),
  conversationThread: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(0.5),
  }),
  threadBubble: css({
    padding: theme.spacing(0.5, 0.75),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    overflowWrap: 'anywhere' as const,
    maxHeight: 400,
    overflow: 'auto',
    fontSize: '12px',
    lineHeight: 1.5,
  }),
  threadBubbleUser: css({
    background: theme.colors.background.primary,
  }),
  threadBubbleAssistant: css({
    background: theme.colors.background.secondary,
  }),
  threadBubbleTool: css({
    background: theme.colors.background.primary,
    borderStyle: 'dashed' as const,
    fontSize: '11px',
  }),
  threadRoleTag: css({
    display: 'inline-block',
    fontWeight: theme.typography.fontWeightMedium,
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(0.25),
  }),
  threadGenLabel: css({
    fontSize: '10px',
    color: theme.colors.text.disabled,
    marginTop: theme.spacing(0.75),
    marginBottom: theme.spacing(0.25),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    paddingTop: theme.spacing(0.5),
  }),
  threadGenLabelHighlighted: css({
    color: theme.colors.primary.text,
    fontWeight: theme.typography.fontWeightMedium,
  }),
});

type SectionProps = {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  children: React.ReactNode;
};

function Section({ title, defaultOpen = false, count, children }: SectionProps) {
  const styles = useStyles2(getStyles);
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader} onClick={() => setOpen(!open)} role="button" tabIndex={0}>
        <span>
          {title}
          {count !== undefined ? ` (${count})` : ''}
        </span>
        <span className={`${styles.sectionChevron} ${open ? styles.sectionChevronOpen : ''}`}>▶</span>
      </div>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} ${mono ? styles.monospace : ''}`}>{value}</span>
    </div>
  );
}

function AttributeTable({ attrs }: { attrs: SpanAttributes }) {
  const styles = useStyles2(getStyles);
  const entries = useMemo(() => sortedAttrs(attrs), [attrs]);

  if (entries.length === 0) {
    return <div className={styles.emptyHint}>No attributes</div>;
  }

  return (
    <>
      {entries.map(([key, val]) => (
        <KV key={key} label={key} value={formatAttrValue(val)} mono />
      ))}
    </>
  );
}

function MessageList({ messages, label }: { messages: Message[]; label: string }) {
  const styles = useStyles2(getStyles);

  if (messages.length === 0) {
    return <div className={styles.emptyHint}>No {label.toLowerCase()}</div>;
  }

  return (
    <>
      {messages.map((msg, i) => {
        const roleLabel = msg.role.replace('MESSAGE_ROLE_', '').toLowerCase();
        return (
          <div key={i} className={styles.messageBlock}>
            <div className={styles.messageRole}>
              {roleLabel}
              {msg.name ? ` (${msg.name})` : ''}
            </div>
            <div className={styles.messageContent}>{messageToText(msg)}</div>
          </div>
        );
      })}
    </>
  );
}

function GenerationSection({ generation }: { generation: GenerationDetail }) {
  const styles = useStyles2(getStyles);

  const usageExtras = useMemo(() => {
    if (!generation.usage) {
      return [];
    }
    return Object.entries(generation.usage)
      .filter(
        ([key, value]) => !['input_tokens', 'output_tokens', 'total_tokens'].includes(key) && typeof value === 'number'
      )
      .sort(([a], [b]) => a.localeCompare(b));
  }, [generation.usage]);

  return (
    <>
      <Section title="Generation" defaultOpen>
        <KV label="Generation ID" value={generation.generation_id} mono />
        <KV label="Conversation ID" value={generation.conversation_id} mono />
        <KV label="Mode" value={generation.mode ?? 'n/a'} />
        <KV
          label="Model"
          value={`${generation.model?.provider ?? 'unknown'} / ${generation.model?.name ?? 'unknown'}`}
        />
        <KV
          label="Agent"
          value={
            generation.agent_name
              ? `${generation.agent_name}${generation.agent_version ? ` (${generation.agent_version})` : ''}`
              : 'n/a'
          }
        />
        <KV label="Stop reason" value={generation.stop_reason ?? 'n/a'} />
        <KV label="Created at" value={generation.created_at ?? 'n/a'} />
        {generation.error?.message && (
          <div className={styles.row}>
            <span className={styles.label}>Error</span>
            <span className={`${styles.value} ${styles.errorValue}`}>{generation.error.message}</span>
          </div>
        )}
      </Section>

      <Section title="Token Usage" defaultOpen>
        <KV label="Input tokens" value={getUsageValue(generation.usage, 'input_tokens')} />
        <KV label="Output tokens" value={getUsageValue(generation.usage, 'output_tokens')} />
        <KV label="Total tokens" value={getUsageValue(generation.usage, 'total_tokens')} />
        {usageExtras.map(([key, value]) => (
          <KV key={key} label={key} value={typeof value === 'number' ? value.toLocaleString() : 'n/a'} />
        ))}
      </Section>

      {generation.system_prompt && (
        <Section title="System Prompt">
          <div className={styles.messageContent}>{generation.system_prompt}</div>
        </Section>
      )}

      <Section title="Input Messages" count={generation.input?.length ?? 0}>
        <MessageList messages={generation.input ?? []} label="Input messages" />
      </Section>

      <Section title="Output Messages" count={generation.output?.length ?? 0}>
        <MessageList messages={generation.output ?? []} label="Output messages" />
      </Section>

      {(generation.tools?.length ?? 0) > 0 && (
        <Section title="Tool Definitions" count={generation.tools?.length ?? 0}>
          {generation.tools!.map((tool, i) => (
            <div key={i} className={styles.messageBlock}>
              <div className={styles.toolName}>{tool.name}</div>
              {tool.description && <div className={styles.value}>{tool.description}</div>}
            </div>
          ))}
        </Section>
      )}

      {generation.metadata && Object.keys(generation.metadata).length > 0 && (
        <Section title="Metadata" count={Object.keys(generation.metadata).length}>
          {Object.entries(generation.metadata)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, val]) => (
              <KV key={key} label={key} value={typeof val === 'string' ? val : JSON.stringify(val)} mono />
            ))}
        </Section>
      )}
    </>
  );
}

function ConversationThread({
  generations,
  highlightedGenerationID,
}: {
  generations: GenerationDetail[];
  highlightedGenerationID?: string;
}) {
  const styles = useStyles2(getStyles);

  const sorted = useMemo(
    () =>
      [...generations].sort((a, b) => {
        const ta = a.created_at ?? '';
        const tb = b.created_at ?? '';
        return ta.localeCompare(tb);
      }),
    [generations]
  );

  if (sorted.length === 0) {
    return <div className={styles.emptyHint}>No generations in this conversation</div>;
  }

  return (
    <div className={styles.conversationThread}>
      {sorted.map((gen) => {
        const isHighlighted = gen.generation_id === highlightedGenerationID;
        const allMessages: Message[] = [...(gen.input ?? []), ...(gen.output ?? [])];
        const modelLabel = gen.model?.name ? `${gen.model.provider ?? ''}/${gen.model.name}` : gen.generation_id;

        return (
          <React.Fragment key={gen.generation_id}>
            <div className={`${styles.threadGenLabel} ${isHighlighted ? styles.threadGenLabelHighlighted : ''}`}>
              {isHighlighted ? '>> ' : ''}
              {modelLabel}
              {gen.created_at ? ` - ${new Date(gen.created_at).toLocaleString()}` : ''}
            </div>
            {allMessages.map((msg, i) => {
              const roleLabel = msg.role.replace('MESSAGE_ROLE_', '').toLowerCase();
              const bubbleStyle =
                msg.role === 'MESSAGE_ROLE_USER'
                  ? styles.threadBubbleUser
                  : msg.role === 'MESSAGE_ROLE_TOOL'
                    ? styles.threadBubbleTool
                    : styles.threadBubbleAssistant;

              return (
                <div key={i} className={`${styles.threadBubble} ${bubbleStyle}`}>
                  <div className={styles.threadRoleTag}>
                    {roleLabel}
                    {msg.name ? ` (${msg.name})` : ''}
                  </div>
                  <div>{messageToText(msg)}</div>
                </div>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function resolveGeneration(
  span: ConversationSpan,
  allGenerations: GenerationDetail[] | undefined
): GenerationDetail | null {
  // Direct match: buildSpanTree already attached the generation via trace_id + span_id.
  if (span.generation) {
    return span.generation;
  }
  if (!allGenerations) {
    return null;
  }
  // Exact trace_id + span_id match for orphan generations that do have span_id set.
  const bySpanID = allGenerations.find((g) => g.trace_id === span.traceID && g.span_id === span.spanID);
  if (bySpanID) {
    return bySpanID;
  }
  // Match via the sigil.generation.id span attribute. This handles orphan generations
  // where the backend did not populate span_id, but the OTLP span carries the generation
  // ID as an attribute. Only generation spans carry this attribute, so this is safe.
  const generationID = getStringAttr(span.attributes, ATTR_GENERATION_ID);
  if (generationID) {
    return allGenerations.find((g) => g.generation_id === generationID) ?? null;
  }
  return null;
}

export default function SpanDetailPanel({ span, allGenerations }: SpanDetailPanelProps) {
  const styles = useStyles2(getStyles);
  const generation = useMemo(() => resolveGeneration(span, allGenerations), [span, allGenerations]);

  return (
    <div className={styles.container}>
      <Section title="Span" defaultOpen>
        <KV label="Name" value={span.name} />
        <KV label="Service" value={span.serviceName} />
        <KV label="Trace ID" value={span.traceID} mono />
        <KV label="Span ID" value={span.spanID} mono />
        <KV label="Parent Span ID" value={span.parentSpanID || 'none'} mono />
        <KV label="Kind" value={span.kind} />
        <KV label="Start" value={formatNsTimestamp(span.startTimeUnixNano)} />
        <KV label="End" value={formatNsTimestamp(span.endTimeUnixNano)} />
        <KV label="Duration" value={formatNsDuration(span.durationNano)} />
      </Section>

      <Section title="Span Attributes" count={span.attributes.size} defaultOpen={generation == null}>
        <AttributeTable attrs={span.attributes} />
      </Section>

      <Section title="Resource Attributes" count={span.resourceAttributes.size}>
        <AttributeTable attrs={span.resourceAttributes} />
      </Section>

      {generation != null && (
        <>
          <GenerationSection generation={generation} />
          {allGenerations && allGenerations.length > 0 && (
            <Section title="Conversation" count={allGenerations.length} defaultOpen>
              <ConversationThread generations={allGenerations} highlightedGenerationID={generation.generation_id} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
