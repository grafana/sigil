import type { ConversationDetail } from '../conversation/types';
import type { TraceTimeline, TraceSpan } from '../components/conversations/ConversationTraces';

// ---------------------------------------------------------------------------
// Helpers -- timestamps anchored at 2026-03-03T08:27:10Z
// ---------------------------------------------------------------------------

const ANCHOR_NS = BigInt('1772525230000000000');

function ns(offsetMs: number): bigint {
  return ANCHOR_NS + BigInt(Math.round(offsetMs * 1_000_000));
}

function span(
  traceID: string,
  spanID: string,
  name: string,
  serviceName: string,
  startMs: number,
  durationMs: number,
  row: number
): TraceSpan {
  const startNs = ns(startMs);
  const durationNs = BigInt(Math.round(durationMs * 1_000_000));
  return {
    traceID,
    spanID,
    name,
    serviceName,
    startNs,
    endNs: startNs + durationNs,
    durationNs,
    row,
    selectionID: `${traceID}:${spanID}`,
  };
}

function timeline(traceID: string, spans: TraceSpan[]): TraceTimeline {
  let minNs = spans[0].startNs;
  let maxNs = spans[0].endNs;
  for (const s of spans) {
    if (s.startNs < minNs) {
      minNs = s.startNs;
    }
    if (s.endNs > maxNs) {
      maxNs = s.endNs;
    }
  }
  const rowCount = spans.reduce((max, s) => Math.max(max, s.row + 1), 1);
  return { traceID, rowCount, spans, startNs: minNs, endNs: maxNs };
}

// ---------------------------------------------------------------------------
// Trace 1 -- Grafana Assistant interaction (Go SDK, Anthropic/Bedrock, ~5.8s)
// Mirrors a real production trace: Frontend -> gateway -> grafana -> plugin ->
// assistant-gateway -> assistant -> LLM generation -> persistence
// ---------------------------------------------------------------------------

const T1 = 'aabbccdd11223344';

const trace1Spans: TraceSpan[] = [
  span(T1, 'f172023100000001', 'HTTP POST', 'Grafana Frontend - Dev', 0, 6185, 0),
  span(T1, '4135e71100000002', 'POST /', 'hggateway', 10, 5822, 1),
  span(T1, 'e340c82900000003', 'gatewayHandler.ServeHTTP', 'hggateway', 11, 5821, 2),
  span(T1, 'b0438efe00000004', 'POST /ofrep/v1/evaluate/flags/:flagKey', 'go-feature-flag', 13, 0.3, 3),
  span(T1, '7fc9fa5500000005', 'POST /ofrep/v1/evaluate/flags/:flagKey', 'go-feature-flag', 15, 0.2, 3),
  span(T1, '8883c43000000006', 'HTTP POST /api/plugins/:pluginId/resources/*', 'grafana', 18, 5814, 3),
  span(T1, '0f6970db00000007', 'PluginClient.callResource', 'grafana', 195, 5622, 4),
  span(T1, 'db93882d00000008', 'pluginv2.Resource/CallResource', 'grafana', 196, 5621, 5),
  span(T1, '0543995400000009', 'sdk.callResource', 'grafana-assistant-app', 197, 5619, 6),
  span(T1, '43e4192500000010', 'HTTP Outgoing Request', 'grafana-assistant-app', 198, 5615, 7),
  span(T1, '2247382300000011', 'HTTP POST - assistant_api_v1_chats_id_prompt', 'assistant-gateway', 203, 5610, 8),
  span(T1, 'de09961f00000012', 'POST /api/v1/chats/{id}/prompt', 'assistant', 205, 5607, 9),
  span(T1, '8ce265ec00000013', 'chat.chatService.Prompt', 'assistant', 212, 5599, 10),
  span(T1, '90ef34d500000014', 'chat.chatService.CreateLLMInput', 'assistant', 228, 3.4, 11),
  span(T1, '52cfcd8a00000015', 'chat.chatService.Generate', 'assistant', 231, 5472, 11),
  span(T1, 'a4a250c500000016', 'llm.claude.Generate', 'assistant', 231, 5472, 12),
  span(T1, '98676c4f00000017', 'generateText us.anthropic.claude-haiku-4-5-20251001-v1:0', 'assistant', 241, 5462, 13),
  span(T1, '31f5310e00000018', 'chat.chatService.CreateChatPrompt', 'assistant', 5703, 107, 11),
  span(T1, '59acc68100000019', 'chat.Store.CreateChatPrompt', 'assistant', 5703, 26.7, 12),
  span(T1, '83de860600000020', 'chat.Store.CreateMessagesAndAddToChat', 'assistant', 5730, 59.3, 12),
  span(T1, '88dc15aa00000021', 'chat.Store.IncrementChatTokens', 'assistant', 5790, 20.4, 12),
];

export const mockTrace1: TraceTimeline = timeline(T1, trace1Spans);

// ---------------------------------------------------------------------------
// Trace 2 -- RAG pipeline (Python SDK, OpenAI, ~1.8s)
// Application-centric: embed -> vector search -> generation
// ---------------------------------------------------------------------------

const T2 = 'eeff00112233aabb';

const trace2Spans: TraceSpan[] = [
  span(T2, 'rag0000000000001', 'rag.pipeline', 'knowledge-service', 6500, 1800, 0),
  span(T2, 'rag0000000000002', 'generateText text-embedding-3-small', 'knowledge-service', 6510, 120, 1),
  span(T2, 'rag0000000000003', 'vectordb.query', 'knowledge-service', 6640, 80, 1),
  span(T2, 'rag0000000000004', 'generateText gpt-4o', 'knowledge-service', 6730, 1400, 1),
  span(T2, 'rag0000000000005', 'document.rerank', 'knowledge-service', 6635, 90, 2),
  span(T2, 'rag0000000000006', 'context.assemble', 'knowledge-service', 6725, 5, 2),
];

export const mockTrace2: TraceTimeline = timeline(T2, trace2Spans);

// ---------------------------------------------------------------------------
// Trace 3 -- Multi-tool agent (Go SDK, Anthropic, ~4.2s)
// Tool-calling pattern: plan -> tools in parallel -> synthesize
// ---------------------------------------------------------------------------

const T3 = '44556677889900aa';

const trace3Spans: TraceSpan[] = [
  span(T3, 'agent000000000001', 'agent.execute', 'code-review-bot', 8500, 4200, 0),
  span(T3, 'agent000000000002', 'generateText claude-sonnet-4-5', 'code-review-bot', 8510, 600, 1),
  span(T3, 'agent000000000003', 'tool.github_pr_review', 'code-review-bot', 9120, 1200, 1),
  span(T3, 'agent000000000004', 'tool.code_analysis', 'code-review-bot', 9130, 800, 2),
  span(T3, 'agent000000000005', 'tool.lint_check', 'code-review-bot', 9140, 600, 3),
  span(T3, 'agent000000000006', 'generateText claude-sonnet-4-5', 'code-review-bot', 10330, 2100, 1),
  span(T3, 'agent000000000007', 'tool.github_comment', 'code-review-bot', 12440, 250, 1),
];

export const mockTrace3: TraceTimeline = timeline(T3, trace3Spans);

// ---------------------------------------------------------------------------
// Trace 4 -- Streaming generation (Go SDK, Anthropic, ~3.1s)
// Simple streaming pattern with chunk processing
// ---------------------------------------------------------------------------

const T4 = 'bbccddee11002233';

const trace4Spans: TraceSpan[] = [
  span(T4, 'stream00000000001', 'stream.handler', 'chat-service', 13000, 3100, 0),
  span(T4, 'stream00000000002', 'auth.validate', 'chat-service', 13005, 12, 1),
  span(T4, 'stream00000000003', 'generateText claude-sonnet-4-5', 'chat-service', 13020, 3000, 1),
  span(T4, 'stream00000000004', 'stream.chunk.flush', 'chat-service', 14020, 5, 2),
  span(T4, 'stream00000000005', 'stream.chunk.flush', 'chat-service', 15020, 4, 2),
  span(T4, 'stream00000000006', 'stream.chunk.flush', 'chat-service', 16010, 6, 2),
  span(T4, 'stream00000000007', 'stream.finalize', 'chat-service', 16020, 75, 2),
];

export const mockTrace4: TraceTimeline = timeline(T4, trace4Spans);

// ---------------------------------------------------------------------------
// All timelines
// ---------------------------------------------------------------------------

export const mockTraceTimelines: TraceTimeline[] = [mockTrace1, mockTrace2, mockTrace3, mockTrace4];

// ---------------------------------------------------------------------------
// Matching ConversationDetail with generations referencing each trace
// ---------------------------------------------------------------------------

export const mockTraceConversationDetail: ConversationDetail = {
  conversation_id: 'conv-trace-story-001',
  generation_count: 4,
  first_generation_at: '2026-03-03T08:27:10Z',
  last_generation_at: '2026-03-03T08:27:26Z',
  generations: [
    {
      generation_id: 'gen-trace1-001',
      conversation_id: 'conv-trace-story-001',
      trace_id: T1,
      span_id: '98676c4f00000017',
      mode: 'SYNC',
      model: { provider: 'bedrock', name: 'claude-haiku-4-5-20251001' },
      agent_name: 'grafana-assistant',
      agent_version: '1.1.48',
      usage: {
        input_tokens: 1539,
        output_tokens: 467,
        total_tokens: 2006,
        cache_read_input_tokens: 0,
      },
      stop_reason: 'end_turn',
      created_at: '2026-03-03T08:27:10Z',
    },
    {
      generation_id: 'gen-trace2-001',
      conversation_id: 'conv-trace-story-001',
      trace_id: T2,
      span_id: 'rag0000000000004',
      mode: 'SYNC',
      model: { provider: 'openai', name: 'gpt-4o' },
      agent_name: 'knowledge-pipeline',
      usage: {
        input_tokens: 3200,
        output_tokens: 890,
        total_tokens: 4090,
      },
      stop_reason: 'end_turn',
      created_at: '2026-03-03T08:27:16Z',
    },
    {
      generation_id: 'gen-trace3-001',
      conversation_id: 'conv-trace-story-001',
      trace_id: T3,
      span_id: 'agent000000000006',
      mode: 'SYNC',
      model: { provider: 'anthropic', name: 'claude-sonnet-4-5' },
      agent_name: 'code-review-bot',
      agent_version: '3.2.1',
      usage: {
        input_tokens: 8400,
        output_tokens: 2100,
        total_tokens: 10500,
        reasoning_tokens: 1200,
      },
      stop_reason: 'end_turn',
      created_at: '2026-03-03T08:27:18Z',
    },
    {
      generation_id: 'gen-trace4-001',
      conversation_id: 'conv-trace-story-001',
      trace_id: T4,
      span_id: 'stream00000000003',
      mode: 'STREAM',
      model: { provider: 'anthropic', name: 'claude-sonnet-4-5' },
      agent_name: 'chat-service',
      usage: {
        input_tokens: 500,
        output_tokens: 1200,
        total_tokens: 1700,
      },
      stop_reason: 'end_turn',
      created_at: '2026-03-03T08:27:23Z',
    },
  ],
  annotations: [
    {
      annotation_id: 'ann-trace-1',
      conversation_id: 'conv-trace-story-001',
      annotation_type: 'NOTE',
      body: 'LLM latency looks high on trace 1 - investigate bedrock cold start',
      operator_id: 'user-ops-1',
      operator_name: 'SRE Bot',
      created_at: '2026-03-03T08:30:00Z',
    },
  ],
};
