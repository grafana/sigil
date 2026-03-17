/**
 * Factory functions for mock SDKMessage objects and test utilities.
 * These match the shapes from @anthropic-ai/claude-agent-sdk types.
 */

import { mock } from 'node:test';

export function makeSystemInit(overrides = {}) {
  return {
    type: 'system',
    subtype: 'init',
    uuid: 'sys-001',
    session_id: 'session-abc',
    model: 'claude-sonnet-4-5-20250514',
    tools: ['Read', 'Write', 'Bash'],
    mcp_servers: [],
    cwd: '/tmp/test',
    apiKeySource: 'env',
    claude_code_version: '1.0.0',
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'text',
    skills: [],
    plugins: [],
    ...overrides,
  };
}

export function makeAssistantMessage(overrides = {}) {
  return {
    type: 'assistant',
    uuid: 'asst-001',
    session_id: 'session-abc',
    parent_tool_use_id: null,
    message: {
      id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5-20250514',
      content: [
        { type: 'text', text: 'Hello, world!' },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 0,
      },
    },
    ...overrides,
  };
}

export function makeAssistantWithToolUse() {
  return makeAssistantMessage({
    message: {
      id: 'msg_02ToolUseExample',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5-20250514',
      content: [
        { type: 'text', text: 'Let me read that file.' },
        {
          type: 'tool_use',
          id: 'toolu_01ABC',
          name: 'Read',
          input: { file_path: '/tmp/test.txt' },
        },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 150,
        output_tokens: 40,
      },
    },
  });
}

export function makeUserMessage(overrides = {}) {
  return {
    type: 'user',
    uuid: 'user-001',
    session_id: 'session-abc',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: 'Hello',
    },
    ...overrides,
  };
}

export function makeUserWithToolResult() {
  return makeUserMessage({
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01ABC',
          content: 'file contents here',
          is_error: false,
        },
      ],
    },
    isSynthetic: true,
    tool_use_result: 'file contents here',
  });
}

export function makeStreamEvent(eventType, delta) {
  return {
    type: 'stream_event',
    uuid: 'stream-001',
    session_id: 'session-abc',
    parent_tool_use_id: null,
    event: {
      type: eventType,
      ...(delta ? { delta } : {}),
    },
  };
}

export function makeResultSuccess(overrides = {}) {
  return {
    type: 'result',
    subtype: 'success',
    uuid: 'result-001',
    session_id: 'session-abc',
    duration_ms: 5000,
    duration_api_ms: 4500,
    is_error: false,
    num_turns: 3,
    result: 'Task completed successfully',
    stop_reason: 'end_turn',
    total_cost_usd: 0.015,
    usage: {
      input_tokens: 500,
      output_tokens: 150,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 0,
    },
    modelUsage: {
      'claude-sonnet-4-5-20250514': { costUSD: 0.015 },
    },
    permission_denials: [],
    ...overrides,
  };
}

export function makeResultError(subtype = 'error_during_execution') {
  return {
    type: 'result',
    subtype,
    uuid: 'result-err-001',
    session_id: 'session-abc',
    duration_ms: 2000,
    duration_api_ms: 1800,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0.003,
    usage: {
      input_tokens: 100,
      output_tokens: 10,
    },
    modelUsage: {},
    permission_denials: [],
    errors: ['Something went wrong'],
  };
}

// --- Mock SigilClient for tests ---

export function makeMockClient() {
  const generationRecorder = {
    setResult: mock.fn(),
    setCallError: mock.fn(),
    setFirstTokenAt: mock.fn(),
    end: mock.fn(),
    getError: mock.fn(() => undefined),
  };
  const toolRecorder = {
    setResult: mock.fn(),
    setCallError: mock.fn(),
    end: mock.fn(),
    getError: mock.fn(() => undefined),
  };
  const client = {
    startGeneration: mock.fn(() => generationRecorder),
    startStreamingGeneration: mock.fn(() => generationRecorder),
    startToolExecution: mock.fn(() => toolRecorder),
  };
  return { client, generationRecorder, toolRecorder };
}

// --- Stream test utilities ---

export async function* mockStream(...messages) {
  for (const msg of messages) {
    yield msg;
  }
}

export async function collectStream(stream) {
  const collected = [];
  for await (const msg of stream) {
    collected.push(msg);
  }
  return collected;
}
