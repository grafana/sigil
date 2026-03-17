import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapBetaMessageToGenerationResult,
  mapUsage,
  extractToolUseBlocks,
  extractMessageLevelError,
} from '../.test-dist/frameworks/claude-agent-sdk/index.js';
import { makeAssistantMessage, makeAssistantWithToolUse } from './frameworks.claude-agent-sdk.helpers.mjs';

describe('claude-agent-sdk mapBetaMessageToGenerationResult', () => {
  it('maps a text-only BetaMessage', () => {
    const msg = makeAssistantMessage();
    const result = mapBetaMessageToGenerationResult(msg.message);

    assert.equal(result.responseId, 'msg_01XFDUDYJgAACzvnptvVoYEL');
    assert.equal(result.responseModel, 'claude-sonnet-4-5-20250514');
    assert.equal(result.stopReason, 'end_turn');
    assert.equal(result.output.length, 1);
    assert.equal(result.output[0].role, 'assistant');
    assert.equal(result.output[0].content, 'Hello, world!');
  });

  it('maps a BetaMessage with tool_use blocks', () => {
    const msg = makeAssistantWithToolUse();
    const result = mapBetaMessageToGenerationResult(msg.message);

    assert.equal(result.responseModel, 'claude-sonnet-4-5-20250514');
    assert.equal(result.stopReason, 'tool_use');
    assert.equal(result.output.length, 1);
    const parts = result.output[0].parts;
    assert.ok(parts !== undefined);
    const toolCallPart = parts.find((p) => p.type === 'tool_call');
    assert.ok(toolCallPart !== undefined);
  });

  it('maps usage correctly', () => {
    const msg = makeAssistantMessage();
    const result = mapBetaMessageToGenerationResult(msg.message);

    assert.deepEqual(result.usage, {
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      cacheReadInputTokens: 50,
    });
  });

  it('handles missing optional usage fields', () => {
    const msg = makeAssistantMessage({
      message: {
        ...makeAssistantMessage().message,
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    const result = mapBetaMessageToGenerationResult(msg.message);

    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 5);
    assert.equal(result.usage.totalTokens, 15);
    assert.equal(result.usage.cacheReadInputTokens, undefined);
  });
});

describe('claude-agent-sdk mapUsage', () => {
  it('returns undefined for missing usage', () => {
    assert.equal(mapUsage(undefined), undefined);
  });

  it('computes totalTokens when not provided', () => {
    const result = mapUsage({ input_tokens: 10, output_tokens: 5 });
    assert.equal(result.totalTokens, 15);
  });

  it('maps cache write tokens when present', () => {
    const result = mapUsage({
      input_tokens: 10,
      output_tokens: 5,
      cache_write_input_tokens: 3,
    });
    assert.equal(result.cacheWriteInputTokens, 3);
  });
});

describe('claude-agent-sdk extractToolUseBlocks', () => {
  it('drops malformed tool_use blocks without ids or names', () => {
    const blocks = extractToolUseBlocks([
      { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { path: '/tmp/a' } },
      { type: 'tool_use', id: '', name: 'Write', input: {} },
      { type: 'tool_use', id: 'toolu_02', name: '', input: {} },
      { type: 'tool_use', name: 'MissingID', input: {} },
    ]);

    assert.deepEqual(blocks, [
      { id: 'toolu_01', name: 'Read', input: { path: '/tmp/a' } },
    ]);
  });
});

describe('claude-agent-sdk extractMessageLevelError', () => {
  it('detects message stop_reason errors that should be exported as call errors', () => {
    const error = extractMessageLevelError({
      stop_reason: 'model_context_window_exceeded',
      content: [],
    });

    assert.equal(error, 'model_context_window_exceeded');
  });
});
