import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withSigilClaudeAgentSdk, interceptPrompt, SigilClaudeAgentSdkHandler } from '../.test-dist/frameworks/claude-agent-sdk/index.js';
import {
  makeMockClient,
  mockStream,
  collectStream,
  makeSystemInit,
  makeAssistantMessage,
  makeAssistantWithToolUse,
  makeUserWithToolResult,
  makeUserMessage,
  makeResultSuccess,
  makeResultError,
  makeStreamEvent,
} from './frameworks.claude-agent-sdk.helpers.mjs';

describe('claude-agent-sdk withSigilClaudeAgentSdk', () => {
  it('passes through all messages unchanged', async () => {
    const { client } = makeMockClient();
    const system = makeSystemInit();
    const assistant = makeAssistantMessage();
    const result = makeResultSuccess();

    const source = mockStream(system, assistant, result);
    const { stream } = withSigilClaudeAgentSdk(source, client);

    const collected = await collectStream(stream);
    assert.equal(collected.length, 3);
    assert.equal(collected[0], system);
    assert.equal(collected[1], assistant);
    assert.equal(collected[2], result);
  });

  it('records a generation from AssistantMessage', async () => {
    const { client, generationRecorder } = makeMockClient();
    const source = mockStream(makeSystemInit(), makeAssistantMessage(), makeResultSuccess());
    const { stream } = withSigilClaudeAgentSdk(source, client);

    await collectStream(stream);

    assert.equal(client.startStreamingGeneration.mock.calls.length, 1);
    assert.equal(generationRecorder.setResult.mock.calls.length, 1);
    assert.equal(generationRecorder.end.mock.calls.length, 1);
  });

  it('records tool execution from tool_use + tool_result pair', async () => {
    const { client, toolRecorder } = makeMockClient();
    const source = mockStream(
      makeSystemInit(),
      makeAssistantWithToolUse(),
      makeUserWithToolResult(),
      makeResultSuccess(),
    );
    const { stream } = withSigilClaudeAgentSdk(source, client);

    await collectStream(stream);

    assert.equal(client.startToolExecution.mock.calls.length, 1);
    assert.equal(toolRecorder.setResult.mock.calls.length, 1);
    assert.equal(toolRecorder.end.mock.calls.length, 1);
  });

  it('passes through unrecognized message types without crashing', async () => {
    const { client } = makeMockClient();
    const unknownMsg = { type: 'status', info: 'running' };
    const source = mockStream(unknownMsg);
    const { stream } = withSigilClaudeAgentSdk(source, client);

    const collected = await collectStream(stream);
    assert.equal(collected.length, 1);
    assert.equal(collected[0], unknownMsg);
    assert.equal(client.startStreamingGeneration.mock.calls.length, 0);
    assert.equal(client.startToolExecution.mock.calls.length, 0);
  });

  it('handles stream errors gracefully — rejects with same error', async () => {
    const { client } = makeMockClient();

    async function* failingSource() {
      yield makeSystemInit();
      throw new Error('stream exploded');
    }

    const { stream } = withSigilClaudeAgentSdk(failingSource(), client);

    await assert.rejects(collectStream(stream), { message: 'stream exploded' });
  });

  it('records TTFT from stream events', async () => {
    const { client, generationRecorder } = makeMockClient();
    const source = mockStream(
      makeSystemInit(),
      makeStreamEvent('content_block_delta', { type: 'text_delta', text: 'Hello' }),
      makeAssistantMessage(),
      makeResultSuccess(),
    );
    const { stream } = withSigilClaudeAgentSdk(source, client);

    await collectStream(stream);

    assert.equal(generationRecorder.setFirstTokenAt.mock.calls.length, 1);
    const tsArg = generationRecorder.setFirstTokenAt.mock.calls[0].arguments[0];
    assert.ok(tsArg instanceof Date);
  });

  it('handles error result subtypes without crashing', async () => {
    const { client } = makeMockClient();
    const source = mockStream(makeSystemInit(), makeResultError('error_during_execution'));
    const { stream } = withSigilClaudeAgentSdk(source, client);

    const collected = await collectStream(stream);
    assert.equal(collected.length, 2);
  });

  it('returns handler in result for manual use', () => {
    const { client } = makeMockClient();
    const source = mockStream();
    const result = withSigilClaudeAgentSdk(source, client);

    assert.ok('stream' in result);
    assert.ok('handler' in result);
    assert.equal(typeof result.handler.handleAssistantMessage, 'function');
  });

  it('calls cleanup only once on error (not doubled)', async () => {
    const { client, toolRecorder } = makeMockClient();

    async function* failingSource() {
      yield makeSystemInit();
      yield makeAssistantWithToolUse();
      throw new Error('mid-stream error');
    }

    const { stream } = withSigilClaudeAgentSdk(failingSource(), client);

    await assert.rejects(collectStream(stream), { message: 'mid-stream error' });
    // Tool recorder should be ended exactly once by cleanup
    assert.equal(toolRecorder.end.mock.calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// interceptPrompt
// ---------------------------------------------------------------------------

describe('claude-agent-sdk interceptPrompt', () => {
  it('captures user messages from streaming input', async () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    const userMsg = {
      type: 'user',
      message: { role: 'user', content: 'What files are here?' },
    };
    const inputStream = mockStream(userMsg);
    const intercepted = interceptPrompt(inputStream, handler);

    // Consume the intercepted stream
    const collected = await collectStream(intercepted);
    assert.equal(collected.length, 1);
    assert.equal(collected[0], userMsg);

    // Now trigger a generation — input should include the intercepted message
    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const result = generationRecorder.setResult.mock.calls[0].arguments[0];
    assert.ok(result.input);
    assert.equal(result.input.length, 1);
    assert.equal(result.input[0].content, 'What files are here?');
  });

  it('handles array content with text blocks', async () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    const userMsg = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' },
        ],
      },
    };
    const intercepted = interceptPrompt(mockStream(userMsg), handler);
    await collectStream(intercepted);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const result = generationRecorder.setResult.mock.calls[0].arguments[0];
    assert.ok(result.input);
    assert.equal(result.input[0].content, 'First part\nSecond part');
  });

  it('captures tool_result blocks from intercepted prompt input', async () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    const userMsg = makeUserWithToolResult();
    const intercepted = interceptPrompt(mockStream(userMsg), handler);
    await collectStream(intercepted);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const result = generationRecorder.setResult.mock.calls[0].arguments[0];
    assert.ok(result.input);
    assert.equal(result.input.length, 1);
    assert.equal(result.input[0].role, 'tool');
    assert.equal(result.input[0].parts[0].toolResult.toolCallId, 'toolu_01ABC');
    assert.equal(result.input[0].parts[0].toolResult.content, 'file contents here');
  });

  it('passes through non-user messages unchanged', async () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    const otherMsg = { type: 'system', subtype: 'init' };
    const intercepted = interceptPrompt(mockStream(otherMsg), handler);
    const collected = await collectStream(intercepted);

    assert.equal(collected.length, 1);
    assert.equal(collected[0], otherMsg);
  });
});
