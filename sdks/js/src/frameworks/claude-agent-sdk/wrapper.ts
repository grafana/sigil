import { SigilClaudeAgentSdkHandler } from './handler.js';
import type { SigilClientLike, FrameworkHandlerOptions } from './handler.js';
import { extractInputMessages } from './mapper.js';

type AnyRecord = Record<string, unknown>;

export interface WithSigilResult {
  stream: AsyncGenerator<unknown, void, undefined>;
  handler: SigilClaudeAgentSdkHandler;
}

/**
 * Wraps a Claude Agent SDK query() stream for Sigil observability.
 *
 * Two calling patterns:
 *
 * 1. Wrap an existing query (output stream only — limited input capture):
 *    withSigilClaudeAgentSdk(query({ prompt, options }), client, opts)
 *
 * 2. Wrap with prompt interception (full input capture for streaming mode):
 *    withSigilClaudeAgentSdk(query({ prompt: intercepted, options }), client, opts)
 *    where `intercepted = interceptPrompt(generator, handler)`
 */
export function withSigilClaudeAgentSdk(
  source: AsyncIterable<unknown>,
  client: SigilClientLike,
  options: FrameworkHandlerOptions & { handler?: SigilClaudeAgentSdkHandler } = {},
): WithSigilResult {
  const handler = options.handler ?? new SigilClaudeAgentSdkHandler(client, options);

  async function* instrumentedStream(): AsyncGenerator<unknown, void, undefined> {
    try {
      for await (const msg of source) {
        const record = msg as AnyRecord;
        const type = record.type;

        if (type === 'system') {
          handler.handleSystemInit(record);
        } else if (type === 'stream_event') {
          handler.handleStreamEvent(record);
        } else if (type === 'assistant') {
          handler.handleAssistantMessage(record);
        } else if (type === 'user') {
          handler.handleUserMessage(record);
        } else if (type === 'result') {
          handler.handleResult(record);
        }
        // All messages (including unrecognized types) are yielded unchanged
        yield msg;
      }
    } finally {
      handler.cleanup();
    }
  }

  return {
    stream: instrumentedStream(),
    handler,
  };
}

/**
 * Wraps a streaming input prompt generator to intercept user messages
 * for Sigil input capture. Use this to wrap the async generator you pass
 * as `prompt` to `query()`.
 *
 * Usage:
 *   const handler = new SigilClaudeAgentSdkHandler(client, opts);
 *   const rawQuery = query({
 *     prompt: interceptPrompt(myGenerator(), handler),
 *     options: { ... },
 *   });
 *   const { stream } = withSigilClaudeAgentSdk(rawQuery, client, { handler });
 */
export function interceptPrompt(
  source: AsyncIterable<unknown>,
  handler: SigilClaudeAgentSdkHandler,
): AsyncGenerator<unknown, void, undefined> {
  async function* intercepted(): AsyncGenerator<unknown, void, undefined> {
    for await (const msg of source) {
      const record = msg as AnyRecord;
      // Capture user message content for Sigil input tracking
      if (record.type === 'user') {
        const message = record.message as AnyRecord | undefined;
        if (message) {
          for (const inputMessage of extractInputMessages(message.content)) {
            handler.addInputMessage(inputMessage);
          }
        }
      }
      yield msg;
    }
  }
  return intercepted();
}
