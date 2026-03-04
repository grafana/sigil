import React from 'react';
import SpanDetailPanel from '../components/conversations/SpanDetailPanel';
import type { ConversationSpan, SpanAttributeValue } from '../conversation/types';
import type { GenerationDetail } from '../generation/types';

function makeAttrs(entries: Array<[string, SpanAttributeValue]>): ReadonlyMap<string, SpanAttributeValue> {
  return new Map(entries);
}

function makeSpan(overrides: Partial<ConversationSpan> = {}): ConversationSpan {
  return {
    traceID: '2b6808efdbcd9251c865b69ec13cc522',
    spanID: 'abc123def456',
    parentSpanID: '',
    name: 'generateText gpt-4o',
    kind: 'CLIENT',
    serviceName: 'llm-gateway',
    startTimeUnixNano: BigInt('1772480417578390317'),
    endTimeUnixNano: BigInt('1772480417752390317'),
    durationNano: BigInt('173999000'),
    attributes: makeAttrs([
      ['gen_ai.operation.name', { stringValue: 'generateText' }],
      ['gen_ai.request.model', { stringValue: 'gpt-4o' }],
      ['gen_ai.usage.input_tokens', { intValue: '1250' }],
      ['gen_ai.usage.output_tokens', { intValue: '340' }],
      ['sigil.generation.id', { stringValue: 'gen-abc-123' }],
      ['sigil.sdk.name', { stringValue: 'sigil-sdk-go' }],
    ]),
    resourceAttributes: makeAttrs([
      ['service.name', { stringValue: 'llm-gateway' }],
      ['deployment.environment', { stringValue: 'production' }],
      ['service.version', { stringValue: '1.4.2' }],
      ['telemetry.sdk.language', { stringValue: 'go' }],
      ['telemetry.sdk.name', { stringValue: 'opentelemetry' }],
      ['host.name', { stringValue: 'worker-node-3' }],
    ]),
    generation: null,
    children: [],
    ...overrides,
  };
}

const sampleGeneration: GenerationDetail = {
  generation_id: 'gen-abc-123',
  conversation_id: 'conv-xyz-789',
  trace_id: '2b6808efdbcd9251c865b69ec13cc522',
  span_id: 'abc123def456',
  mode: 'SYNC',
  model: { provider: 'openai', name: 'gpt-4o' },
  agent_name: 'code-assistant',
  agent_version: '2.1.0',
  system_prompt: 'You are a helpful coding assistant. Answer concisely and provide code examples when appropriate.',
  stop_reason: 'end_turn',
  created_at: '2025-06-15T10:30:00.000Z',
  usage: {
    input_tokens: 1250,
    output_tokens: 340,
    total_tokens: 1590,
    cache_read_input_tokens: 800,
    reasoning_tokens: 50,
  },
  input: [
    {
      role: 'MESSAGE_ROLE_USER',
      parts: [{ text: 'How do I parse JSON in Go?' }],
    },
  ],
  output: [
    {
      role: 'MESSAGE_ROLE_ASSISTANT',
      parts: [
        {
          text: 'You can use the `encoding/json` package:\n\n```go\nvar data map[string]any\nerr := json.Unmarshal([]byte(jsonStr), &data)\n```',
        },
      ],
    },
  ],
  tools: [
    {
      name: 'search_docs',
      description: 'Search documentation for a given query',
      type: 'function',
      input_schema_json: '{"type":"object","properties":{"query":{"type":"string"}}}',
    },
  ],
  metadata: {
    environment: 'production',
    user_id: 'user-42',
  },
  error: null,
};

const secondGeneration: GenerationDetail = {
  generation_id: 'gen-def-456',
  conversation_id: 'conv-xyz-789',
  trace_id: '2b6808efdbcd9251c865b69ec13cc522',
  span_id: 'def456ghi789',
  mode: 'SYNC',
  model: { provider: 'openai', name: 'gpt-4o' },
  agent_name: 'code-assistant',
  stop_reason: 'end_turn',
  created_at: '2025-06-15T10:31:00.000Z',
  usage: { input_tokens: 2100, output_tokens: 580, total_tokens: 2680 },
  input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Can you show error handling too?' }] }],
  output: [
    {
      role: 'MESSAGE_ROLE_ASSISTANT',
      parts: [
        {
          text: 'Sure! Here is how to handle JSON errors:\n\n```go\nif err := json.Unmarshal(data, &result); err != nil {\n    log.Fatal(err)\n}\n```',
        },
      ],
    },
  ],
  error: null,
};

const allGens = [sampleGeneration, secondGeneration];

export default {
  title: 'Conversations/SpanDetailPanel',
  component: SpanDetailPanel,
};

export const SpanOnly = () => <SpanDetailPanel span={makeSpan()} />;

export const WithGeneration = () => (
  <SpanDetailPanel span={makeSpan({ generation: sampleGeneration })} allGenerations={allGens} />
);

export const WithError = () => (
  <SpanDetailPanel
    span={makeSpan({
      generation: {
        ...sampleGeneration,
        error: { message: 'Rate limit exceeded: 429 Too Many Requests' },
        output: [],
        stop_reason: undefined,
      },
    })}
    allGenerations={allGens}
  />
);

export const ToolExecution = () => (
  <SpanDetailPanel
    span={makeSpan({
      name: 'execute_tool search_docs',
      attributes: makeAttrs([
        ['gen_ai.operation.name', { stringValue: 'execute_tool' }],
        ['gen_ai.tool.name', { stringValue: 'search_docs' }],
      ]),
      generation: null,
    })}
    allGenerations={allGens}
  />
);

export const NoGenerationFallback = () => (
  <SpanDetailPanel span={makeSpan({ generation: null })} allGenerations={allGens} />
);

export const MinimalSpan = () => (
  <SpanDetailPanel
    span={makeSpan({
      attributes: new Map(),
      resourceAttributes: new Map(),
      generation: null,
    })}
  />
);

export const WithToolMessages = () => (
  <SpanDetailPanel
    span={makeSpan({
      generation: {
        ...sampleGeneration,
        input: [
          {
            role: 'MESSAGE_ROLE_USER',
            parts: [{ text: 'Find docs about error handling in Go' }],
          },
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [
              {
                tool_call: {
                  id: 'call_123',
                  name: 'search_docs',
                  input_json: '{"query":"go error handling"}',
                },
              },
            ],
          },
          {
            role: 'MESSAGE_ROLE_TOOL',
            name: 'search_docs',
            parts: [
              {
                tool_result: {
                  tool_call_id: 'call_123',
                  name: 'search_docs',
                  content: 'Go uses explicit error values rather than exceptions...',
                },
              },
            ],
          },
        ],
        output: [
          {
            role: 'MESSAGE_ROLE_ASSISTANT',
            parts: [
              { text: 'Based on the documentation, Go handles errors explicitly using the `error` interface...' },
            ],
          },
        ],
      },
    })}
    allGenerations={allGens}
  />
);
