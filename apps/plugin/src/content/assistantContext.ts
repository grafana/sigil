import { createAssistantContextItem, type ChatContextItem } from '@grafana/assistant';
import { sigilProjectContext } from './sigilProjectContext';
import { getAllSpans, toNum, type TokenSummary, type CostSummary } from '../conversation/aggregates';
import type { ConversationData, ConversationSpan } from '../conversation/types';
import type { GenerationCostResult, GenerationDetail } from '../generation/types';
import { getSpanType } from '../conversation/spans';

const PROJECT_CONTEXT_HEADER = 'Sigil knowledgebase';

const MAX_GENERATION_ENTRIES = 30;
const MAX_DISTINCT_MODELS = 20;
const MAX_DISTINCT_AGENTS = 20;
const MAX_DISTINCT_TRACE_IDS = 50;
const MAX_SLOWEST_SPANS = 10;

function collectDistinct<T>(items: T[], extractor: (item: T) => string | undefined, limit: number): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    const value = extractor(item)?.trim();
    if (value) {
      seen.add(value);
      if (seen.size >= limit) {
        break;
      }
    }
  }
  return Array.from(seen);
}

export function buildSigilAssistantPrompt(userPrompt: string): string {
  return userPrompt.trim();
}

export function buildSigilAssistantContextItems(): ChatContextItem[] {
  return [
    createAssistantContextItem('structured', {
      title: PROJECT_CONTEXT_HEADER,
      bypassLimits: true,
      data: {
        name: PROJECT_CONTEXT_HEADER,
        text: sigilProjectContext,
      },
    }),
  ];
}

// URL fallback path cannot pass structured context, so embed it in text.
export function withSigilProjectContextFallback(userPrompt: string): string {
  const prompt = userPrompt.trim();
  if (prompt.length === 0) {
    return '';
  }
  return [
    'You are answering questions about Grafana Sigil. Use the context below as authoritative background information.',
    '',
    `--- ${PROJECT_CONTEXT_HEADER} (ground truth) ---`,
    sigilProjectContext,
    `--- End ${PROJECT_CONTEXT_HEADER} ---`,
    '',
    'User request:',
    prompt,
  ].join('\n');
}

export type ConversationContextInput = {
  conversationID: string;
  conversationTitle: string;
  conversationData: ConversationData | null;
  allGenerations: GenerationDetail[];
  tokenSummary: TokenSummary | null;
  costSummary: CostSummary | null;
  generationCosts: Map<string, GenerationCostResult>;
  totalDurationMs?: number;
};

/**
 * Visible context pill shown in the Assistant UI so the user
 * knows conversation data is attached.
 */
export function buildConversationSummaryContext(input: ConversationContextInput): ChatContextItem {
  const {
    conversationID,
    conversationTitle,
    conversationData,
    allGenerations,
    tokenSummary,
    costSummary,
    totalDurationMs,
  } = input;
  const errorCount = allGenerations.filter((g) => Boolean(g.error?.message)).length;
  const models = collectDistinct(allGenerations, (g) => g.model?.name, MAX_DISTINCT_MODELS);
  const traceIds = collectDistinct(allGenerations, (g) => g.trace_id, MAX_DISTINCT_TRACE_IDS);

  return createAssistantContextItem('structured', {
    title: `Conversation: ${conversationTitle || conversationID}`,
    data: {
      conversation_id: conversationID,
      generation_count: conversationData?.generationCount ?? allGenerations.length,
      total_duration_ms: totalDurationMs ?? null,
      trace_ids: traceIds,
      tokens: tokenSummary
        ? { input: tokenSummary.inputTokens, output: tokenSummary.outputTokens, total: tokenSummary.totalTokens }
        : null,
      cost_usd: costSummary?.totalCost ?? null,
      error_count: errorCount,
      models,
    },
  });
}

/**
 * Hidden context with per-generation breakdown and span analysis data.
 * Gives the LLM enough detail to answer questions like "why is this conversation slow?"
 *
 * Lists are capped to keep context size bounded:
 * - generations: MAX_GENERATION_ENTRIES (sorted by duration desc, then remainder by order)
 * - slowest/costliest: 5 each
 * - models/agents/trace_ids: capped distinct sets
 */
export function buildConversationAnalysisContext(input: ConversationContextInput): ChatContextItem {
  const {
    conversationID,
    conversationData,
    allGenerations,
    tokenSummary,
    costSummary,
    generationCosts,
    totalDurationMs,
  } = input;
  const errorCount = allGenerations.filter((g) => Boolean(g.error?.message)).length;
  const models = collectDistinct(allGenerations, (g) => g.model?.name, MAX_DISTINCT_MODELS);
  const agents = collectDistinct(allGenerations, (g) => g.agent_name?.trim(), MAX_DISTINCT_AGENTS);
  const traceIds = collectDistinct(allGenerations, (g) => g.trace_id, MAX_DISTINCT_TRACE_IDS);

  const allMapped = allGenerations.map((gen) => {
    const cost = generationCosts.get(gen.generation_id);
    const span = conversationData ? findSpanForGeneration(conversationData, gen.generation_id) : null;
    const durationMs = span ? Number(span.durationNano / BigInt(1_000_000)) : null;

    return {
      id: gen.generation_id,
      trace_id: gen.trace_id ?? null,
      span_id: gen.span_id ?? null,
      model: gen.model?.name ?? null,
      provider: gen.model?.provider ?? null,
      agent: gen.agent_name ?? null,
      mode: gen.mode ?? null,
      created_at: gen.created_at ?? null,
      duration_ms: durationMs,
      input_tokens: gen.usage?.input_tokens ?? null,
      output_tokens: gen.usage?.output_tokens ?? null,
      total_tokens:
        gen.usage != null
          ? toNum(gen.usage.input_tokens) +
            toNum(gen.usage.output_tokens) +
            toNum(gen.usage.cache_read_input_tokens) +
            toNum(gen.usage.cache_write_input_tokens)
          : null,
      cost_usd: cost?.breakdown.totalCost ?? null,
      has_error: Boolean(gen.error?.message),
      error_message: gen.error?.message ?? null,
    };
  });

  const sortedByDuration = [...allMapped]
    .filter((g) => g.duration_ms !== null)
    .sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0));
  const slowestGenerations = sortedByDuration.slice(0, 5);

  const sortedByCost = [...allMapped]
    .filter((g) => g.cost_usd !== null && g.cost_usd > 0)
    .sort((a, b) => (b.cost_usd ?? 0) - (a.cost_usd ?? 0));
  const costliestGenerations = sortedByCost.slice(0, 5);

  const generations = allMapped.slice(0, MAX_GENERATION_ENTRIES);
  const generationsTruncated =
    allMapped.length > MAX_GENERATION_ENTRIES ? allMapped.length - MAX_GENERATION_ENTRIES : 0;

  let spanBreakdown: Record<string, number> | null = null;
  let slowestSpans: Array<{ name: string; type: string; trace_id: string; span_id: string; duration_ms: number }> = [];
  if (conversationData) {
    const allSpans = getAllSpans(conversationData);
    const counts: Record<string, number> = {};
    for (const span of allSpans) {
      const type = getSpanType(span);
      counts[type] = (counts[type] ?? 0) + 1;
    }
    spanBreakdown = counts;

    slowestSpans = allSpans
      .map((s) => ({
        name: s.name,
        type: getSpanType(s),
        trace_id: s.traceID,
        span_id: s.spanID,
        duration_ms: Number(s.durationNano / BigInt(1_000_000)),
      }))
      .sort((a, b) => b.duration_ms - a.duration_ms)
      .slice(0, MAX_SLOWEST_SPANS);
  }

  return createAssistantContextItem('structured', {
    hidden: true,
    title: 'Conversation analysis data',
    data: {
      conversation_id: conversationID,
      total_duration_ms: totalDurationMs ?? null,
      generation_count: conversationData?.generationCount ?? allGenerations.length,
      trace_ids: traceIds,
      tokens: tokenSummary
        ? {
            input: tokenSummary.inputTokens,
            output: tokenSummary.outputTokens,
            cache_read: tokenSummary.cacheReadTokens,
            cache_write: tokenSummary.cacheWriteTokens,
            reasoning: tokenSummary.reasoningTokens,
            total: tokenSummary.totalTokens,
          }
        : null,
      cost_usd: costSummary?.totalCost ?? null,
      cost_breakdown: costSummary
        ? {
            input: costSummary.inputCost,
            output: costSummary.outputCost,
            cache_read: costSummary.cacheReadCost,
            cache_write: costSummary.cacheWriteCost,
          }
        : null,
      error_count: errorCount,
      models,
      agents,
      span_type_breakdown: spanBreakdown,
      slowest_spans: slowestSpans,
      slowest_generations: slowestGenerations,
      costliest_generations: costliestGenerations,
      generations,
      generations_truncated: generationsTruncated,
    },
  });
}

/**
 * Hidden system instructions telling the Assistant how to analyze Sigil conversation data.
 */
export function buildConversationSystemInstructions(): ChatContextItem {
  return createAssistantContextItem('structured', {
    hidden: true,
    title: 'Conversation analysis instructions',
    data: {
      instructions: [
        'You are analyzing a Sigil conversation trace. The attached context includes per-generation latency, token usage, cost, error data, trace IDs, span IDs, and span timing.',
        'When asked about slowness, first check slowest_spans — these are the longest spans from the trace tree and directly show where time was spent (each has name, type, trace_id, span_id, duration_ms). Then check slowest_generations for per-generation duration_ms.',
        'If generation duration_ms is null (spans could not be matched to generations), use created_at timestamps to infer timing: sort generations chronologically and compute gaps between consecutive created_at values to identify where the conversation stalled.',
        'When asked about cost, highlight the costliest generations and suggest alternatives (cheaper models, caching, shorter prompts).',
        'When asked about errors, list generations with has_error=true and their error_message.',
        'Reference specific generation IDs, agent names, model names, and trace IDs in your answers so the user can locate the problem.',
        'When trace_id or span_id is available for a generation or span, mention them so the user can look up the exact span in Tempo/Grafana Explore.',
        'If the user asks about trends or broader patterns, suggest PromQL queries using the OTel metrics (gen_ai_client_token_usage, gen_ai_client_operation_duration_seconds) with appropriate label filters for the models/agents in this conversation.',
        'Keep answers concise and actionable. Use bullet points for findings.',
      ],
    },
  });
}

function findSpanForGeneration(data: ConversationData, generationId: string): ConversationSpan | null {
  function walk(spans: ConversationSpan[]): ConversationSpan | null {
    for (const span of spans) {
      if (span.generation?.generation_id === generationId) {
        return span;
      }
      const found = walk(span.children);
      if (found) {
        return found;
      }
    }
    return null;
  }
  return walk(data.spans);
}
