import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SigilClaudeAgentSdkHandler } from '../.test-dist/frameworks/claude-agent-sdk/index.js';
import {
  makeMockClient,
  makeSystemInit,
  makeAssistantMessage,
  makeAssistantWithToolUse,
  makeUserMessage,
  makeUserWithToolResult,
  makeStreamEvent,
  makeResultSuccess,
  makeResultError,
} from './frameworks.claude-agent-sdk.helpers.mjs';

// ---------------------------------------------------------------------------
// handleSystemInit
// ---------------------------------------------------------------------------

describe('claude-agent-sdk handleSystemInit', () => {
  it('captures session context (verified by subsequent assistant message creating a generation)', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    assert.equal(client.startStreamingGeneration.mock.calls.length, 1);
    const startArg = client.startStreamingGeneration.mock.calls[0].arguments[0];
    assert.equal(startArg.conversationId, 'session-abc');
    assert.equal(generationRecorder.end.mock.calls.length, 1);
  });

  it('ignores non-init system messages (subtype: compact_boundary)', () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    // Send compact_boundary — should NOT capture session context
    handler.handleSystemInit({ type: 'system', subtype: 'compact_boundary', uuid: 'sys-002', session_id: 'session-xyz' });
    // Send an assistant message whose own session_id differs from compact_boundary
    handler.handleAssistantMessage(makeAssistantMessage({ session_id: 'session-abc' }));

    assert.equal(client.startStreamingGeneration.mock.calls.length, 1);
    const startArg = client.startStreamingGeneration.mock.calls[0].arguments[0];
    // Should use the assistant message's session_id, not the compact_boundary's
    assert.equal(startArg.conversationId, 'session-abc');
  });
});

// ---------------------------------------------------------------------------
// handleAssistantMessage
// ---------------------------------------------------------------------------

describe('claude-agent-sdk handleAssistantMessage', () => {
  it('records a generation for text response', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    assert.equal(client.startStreamingGeneration.mock.calls.length, 1);
    assert.equal(generationRecorder.setResult.mock.calls.length, 1);
    assert.equal(generationRecorder.end.mock.calls.length, 1);
  });

  it('records tool starts for tool_use blocks', () => {
    const { client, toolRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantWithToolUse());

    assert.equal(client.startToolExecution.mock.calls.length, 1);
    const toolStartArg = client.startToolExecution.mock.calls[0].arguments[0];
    assert.equal(toolStartArg.toolName, 'Read');
    assert.equal(toolStartArg.requestModel, 'claude-sonnet-4-5-20250514');
    assert.equal(toolStartArg.requestProvider, 'anthropic');
    assert.equal(toolStartArg.includeContent, true);
    // Tool recorder should NOT be ended yet — waiting for tool_result
    assert.equal(toolRecorder.end.mock.calls.length, 0);
  });

  it('calls setCallError when msg.error is a string (SDKAssistantMessageError)', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(
      makeAssistantMessage({ error: 'rate_limit' })
    );

    assert.equal(generationRecorder.setCallError.mock.calls.length, 1);
    const errArg = generationRecorder.setCallError.mock.calls[0].arguments[0];
    assert.equal(errArg, 'rate_limit');
    assert.equal(generationRecorder.setResult.mock.calls.length, 0);
    assert.equal(generationRecorder.end.mock.calls.length, 1);
  });

  it('handles all SDKAssistantMessageError string variants', () => {
    const errorTypes = ['authentication_failed', 'billing_error', 'rate_limit', 'invalid_request', 'server_error', 'unknown'];

    for (const errorType of errorTypes) {
      const { client, generationRecorder } = makeMockClient();
      const handler = new SigilClaudeAgentSdkHandler(client);

      handler.handleSystemInit(makeSystemInit());
      handler.handleAssistantMessage(makeAssistantMessage({ error: errorType }));

      assert.equal(generationRecorder.setCallError.mock.calls.length, 1, `setCallError not called for "${errorType}"`);
      assert.equal(generationRecorder.setCallError.mock.calls[0].arguments[0], errorType);
    }
  });

  it('treats message-level stop_reason errors as call errors', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(
      makeAssistantMessage({
        message: {
          ...makeAssistantMessage().message,
          stop_reason: 'model_context_window_exceeded',
        },
      })
    );

    assert.equal(generationRecorder.setCallError.mock.calls.length, 1);
    assert.equal(generationRecorder.setCallError.mock.calls[0].arguments[0], 'model_context_window_exceeded');
    assert.equal(generationRecorder.setResult.mock.calls.length, 0);
  });

  it('passes parent_tool_use_id in metadata for subagent messages', () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(
      makeAssistantMessage({ parent_tool_use_id: 'parent-tool-123' })
    );

    const startArg = client.startStreamingGeneration.mock.calls[0].arguments[0];
    assert.equal(startArg.metadata?.parent_tool_use_id, 'parent-tool-123');
  });

  it('uses conversationId option instead of session_id when provided', () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client, {
      conversationId: 'dag-123',
    });

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const startArg = client.startStreamingGeneration.mock.calls[0].arguments[0];
    assert.equal(startArg.conversationId, 'dag-123');
  });

  it('sets STREAM mode explicitly on generation start', () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const startArg = client.startStreamingGeneration.mock.calls[0].arguments[0];
    assert.equal(startArg.mode, 'STREAM');
  });

  it('suppresses output when captureOutputs is false', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client, { captureOutputs: false });

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const result = generationRecorder.setResult.mock.calls[0].arguments[0];
    assert.equal(result.output.length, 0);
  });

  it('suppresses input when captureInputs is false', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client, { captureInputs: false });

    handler.handleSystemInit(makeSystemInit());
    handler.handleUserMessage(makeUserMessage());
    handler.handleAssistantMessage(makeAssistantMessage());

    const result = generationRecorder.setResult.mock.calls[0].arguments[0];
    assert.equal(result.input, undefined);
  });

  it('passes systemPrompt to generation start', () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client, {
      systemPrompt: 'You are a helpful assistant.',
    });

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const startArg = client.startStreamingGeneration.mock.calls[0].arguments[0];
    assert.equal(startArg.systemPrompt, 'You are a helpful assistant.');
  });

  it('seeds pendingInputMessages from initialPrompt option', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client, {
      initialPrompt: 'Fix the bug in auth.py',
    });

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const result = generationRecorder.setResult.mock.calls[0].arguments[0];
    assert.ok(result.input);
    assert.equal(result.input.length, 1);
    assert.equal(result.input[0].role, 'user');
    assert.equal(result.input[0].content, 'Fix the bug in auth.py');
  });

  it('includes extraMetadata on recorded generations', () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client, {
      extraMetadata: { 'my.custom.key': 'value1' },
    });

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const startArg = client.startStreamingGeneration.mock.calls[0].arguments[0];
    assert.equal(startArg.metadata?.['my.custom.key'], 'value1');
  });
});

// ---------------------------------------------------------------------------
// handleUserMessage
// ---------------------------------------------------------------------------

describe('claude-agent-sdk handleUserMessage', () => {
  it('matches tool_result to pending tool execution', () => {
    const { client, toolRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantWithToolUse());
    handler.handleUserMessage(makeUserWithToolResult());

    assert.equal(toolRecorder.setResult.mock.calls.length, 1);
    const resultArg = toolRecorder.setResult.mock.calls[0].arguments[0];
    assert.equal(resultArg.result, 'file contents here');
    assert.equal(toolRecorder.end.mock.calls.length, 1);
  });

  it('handles tool_result with is_error: true', () => {
    const { client, toolRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantWithToolUse());
    handler.handleUserMessage(
      makeUserMessage({
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01ABC',
              content: 'error output',
              is_error: true,
            },
          ],
        },
      })
    );

    assert.equal(toolRecorder.setCallError.mock.calls.length, 1);
    assert.equal(toolRecorder.end.mock.calls.length, 1);
  });

  it('ignores string content (no tool_result blocks)', () => {
    const { client, toolRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantWithToolUse());
    handler.handleUserMessage(makeUserMessage());

    assert.equal(toolRecorder.setResult.mock.calls.length, 0);
    assert.equal(toolRecorder.end.mock.calls.length, 0);
  });

  it('captures tool_result content as tool-role input for the next generation', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleUserMessage(makeUserWithToolResult());
    handler.handleAssistantMessage(makeAssistantMessage());

    const result = generationRecorder.setResult.mock.calls[0].arguments[0];
    assert.ok(result.input);
    assert.equal(result.input.length, 1);
    assert.equal(result.input[0].role, 'tool');
    assert.equal(result.input[0].parts[0].toolResult.toolCallId, 'toolu_01ABC');
    assert.equal(result.input[0].parts[0].toolResult.content, 'file contents here');
  });
});

// ---------------------------------------------------------------------------
// handleStreamEvent
// ---------------------------------------------------------------------------

describe('claude-agent-sdk handleStreamEvent', () => {
  it('records first token time on first text_delta', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleStreamEvent(makeStreamEvent('content_block_delta', { type: 'text_delta', text: 'Hi' }));
    handler.handleAssistantMessage(makeAssistantMessage());

    assert.equal(generationRecorder.setFirstTokenAt.mock.calls.length, 1);
    const tsArg = generationRecorder.setFirstTokenAt.mock.calls[0].arguments[0];
    assert.ok(tsArg instanceof Date);
  });

  it('uses the earliest observed stream event as generation startedAt', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleStreamEvent(makeStreamEvent('message_start'));
    handler.handleStreamEvent(makeStreamEvent('content_block_delta', { type: 'text_delta', text: 'Hi' }));
    handler.handleAssistantMessage(makeAssistantMessage());

    const startArg = client.startStreamingGeneration.mock.calls[0].arguments[0];
    const ttftArg = generationRecorder.setFirstTokenAt.mock.calls[0].arguments[0];
    assert.ok(startArg.startedAt instanceof Date);
    assert.ok(ttftArg instanceof Date);
    assert.ok(ttftArg.getTime() >= startArg.startedAt.getTime());
  });
});

// ---------------------------------------------------------------------------
// handleResult
// ---------------------------------------------------------------------------

describe('claude-agent-sdk handleResult', () => {
  it('stores cost metadata from success result', () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleResult(makeResultSuccess());

    const meta = handler.getResultMetadata();
    assert.ok(meta !== undefined);
    assert.equal(meta.total_cost_usd, 0.015);
    assert.equal(meta.duration_ms, 5000);
    assert.equal(meta.num_turns, 3);
    assert.ok(meta.modelUsage !== undefined);
  });

  it('handles error result subtypes', () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleResult(makeResultError('error_during_execution'));

    const meta = handler.getResultMetadata();
    assert.ok(meta !== undefined);
    assert.equal(meta.total_cost_usd, 0.003);
  });
});

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

describe('claude-agent-sdk cleanup', () => {
  it('flushes orphaned tool recorders', () => {
    const { client, toolRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantWithToolUse());
    // No tool_result — simulate premature end
    handler.cleanup();

    assert.equal(toolRecorder.setCallError.mock.calls.length, 1);
    assert.equal(toolRecorder.end.mock.calls.length, 1);
  });

  it('is idempotent (double cleanup is safe)', () => {
    const { client, toolRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantWithToolUse());
    handler.cleanup();
    handler.cleanup();

    // Only ended once
    assert.equal(toolRecorder.end.mock.calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// options passthrough
// ---------------------------------------------------------------------------

describe('claude-agent-sdk options passthrough', () => {
  it('includes agentName and agentVersion on recorded generations', () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client, {
      agentName: 'my-agent',
      agentVersion: '2.0.0',
    });

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const startArg = client.startStreamingGeneration.mock.calls[0].arguments[0];
    assert.equal(startArg.agentName, 'my-agent');
    assert.equal(startArg.agentVersion, '2.0.0');
  });

  it('includes extraTags on recorded generations', () => {
    const { client } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client, {
      extraTags: { 'my.custom.tag': 'value1' },
    });

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    const startArg = client.startStreamingGeneration.mock.calls[0].arguments[0];
    assert.equal(startArg.tags?.['my.custom.tag'], 'value1');
    assert.equal(startArg.tags?.['sigil.framework.name'], 'claude-agent-sdk');
    assert.equal(startArg.tags?.['sigil.framework.source'], 'handler');
    assert.equal(startArg.tags?.['sigil.framework.language'], 'javascript');
  });
});

// ---------------------------------------------------------------------------
// no streaming events
// ---------------------------------------------------------------------------

describe('claude-agent-sdk no streaming events', () => {
  it('records generation without prior stream events (setFirstTokenAt NOT called)', () => {
    const { client, generationRecorder } = makeMockClient();
    const handler = new SigilClaudeAgentSdkHandler(client);

    handler.handleSystemInit(makeSystemInit());
    handler.handleAssistantMessage(makeAssistantMessage());

    assert.equal(generationRecorder.setFirstTokenAt.mock.calls.length, 0);
    assert.equal(generationRecorder.setResult.mock.calls.length, 1);
    assert.equal(generationRecorder.end.mock.calls.length, 1);
  });
});
