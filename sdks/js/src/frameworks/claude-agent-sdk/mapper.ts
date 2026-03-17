/**
 * Maps BetaMessage from the Anthropic API (as delivered by the Claude Agent SDK)
 * to Sigil GenerationResult format.
 */

import type {
  GenerationResult,
  Message,
  MessagePart,
  PartMetadata,
  TokenUsage,
  ToolCallPart,
  ToolResultPart,
} from '../../types.js';

type AnyRecord = Record<string, unknown>;

export type GenerationResultLike = GenerationResult;

export interface ExtractedToolResultBlock {
  tool_use_id: string;
  name?: string;
  rawContent: unknown;
  content?: string;
  contentJSON?: string;
  is_error?: boolean;
}

const stopReasonMessageLevelErrors = new Set([
  'model_context_window_exceeded',
]);

export function mapBetaMessageToGenerationResult(betaMessage: AnyRecord): GenerationResultLike {
  const content = betaMessage.content;
  const output = mapResponseOutput(content);
  const usage = mapUsage(betaMessage.usage as AnyRecord | undefined);

  return {
    responseId: asString(betaMessage.id),
    responseModel: asString(betaMessage.model),
    output,
    usage,
    stopReason: asString(betaMessage.stop_reason) || undefined,
  };
}

function mapResponseOutput(content: unknown): Message[] {
  const parts = mapContentParts(content);
  const text = extractText(content);

  if (parts.length === 0 && text.length === 0) {
    return [];
  }

  return [{
    role: 'assistant',
    content: text || undefined,
    parts: parts.length > 0 ? parts : undefined,
  }];
}

function mapContentParts(content: unknown): MessagePart[] {
  if (!Array.isArray(content)) return [];

  const parts: MessagePart[] = [];

  for (const block of content) {
    if (!isRecord(block)) continue;

    const blockType = asString(block.type);

    if (blockType === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
      parts.push({ type: 'text', text: block.text, metadata: { providerType: blockType } });
      continue;
    }

    if (blockType === 'thinking' || blockType === 'redacted_thinking') {
      const thinking = asString(block.thinking) || asString(block.data) || asString(block.text);
      if (thinking.length > 0) {
        parts.push({ type: 'thinking', thinking, metadata: { providerType: blockType } });
      }
      continue;
    }

    if (blockType === 'tool_use' || blockType === 'server_tool_use' || blockType === 'mcp_tool_use') {
      const name = asString(block.name);
      if (name.length === 0) continue;

      parts.push({
        type: 'tool_call',
        toolCall: {
          id: asString(block.id) || undefined,
          name,
          inputJSON: jsonString(block.input),
        },
        metadata: { providerType: blockType },
      });
      continue;
    }

    if (blockType === 'tool_result') {
      parts.push({
        type: 'tool_result',
        toolResult: {
          toolCallId: asString(block.tool_use_id) || undefined,
          name: asString(block.name) || undefined,
          content: extractText(block.content) || undefined,
          contentJSON: jsonString(block.content),
          isError: typeof block.is_error === 'boolean' ? block.is_error : undefined,
        },
        metadata: { providerType: blockType },
      });
    }
  }

  return parts;
}

export function mapUsage(rawUsage: AnyRecord | undefined): TokenUsage | undefined {
  if (!rawUsage || !isRecord(rawUsage)) return undefined;

  const inputTokens = asInt(rawUsage.input_tokens);
  const outputTokens = asInt(rawUsage.output_tokens);
  const cacheReadInputTokens = asInt(rawUsage.cache_read_input_tokens);
  const cacheWriteInputTokens = asInt(rawUsage.cache_write_input_tokens);
  const cacheCreationInputTokens = asInt(rawUsage.cache_creation_input_tokens);

  const out: TokenUsage = {};
  if (inputTokens !== undefined) out.inputTokens = inputTokens;
  if (outputTokens !== undefined) out.outputTokens = outputTokens;
  if (inputTokens !== undefined || outputTokens !== undefined) {
    out.totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }
  if (cacheReadInputTokens !== undefined && cacheReadInputTokens > 0) {
    out.cacheReadInputTokens = cacheReadInputTokens;
  }
  if (cacheWriteInputTokens !== undefined && cacheWriteInputTokens > 0) {
    out.cacheWriteInputTokens = cacheWriteInputTokens;
  }
  if (cacheCreationInputTokens !== undefined && cacheCreationInputTokens > 0) {
    out.cacheCreationInputTokens = cacheCreationInputTokens;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/** Extract tool_use blocks from BetaMessage content. */
export function extractToolUseBlocks(content: unknown): Array<{ id: string; name: string; input: unknown }> {
  if (!Array.isArray(content)) return [];

  const out: Array<{ id: string; name: string; input: unknown }> = [];

  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type !== 'tool_use' && block.type !== 'server_tool_use' && block.type !== 'mcp_tool_use') {
      continue;
    }

    const id = asString(block.id);
    const name = asString(block.name);
    if (id.length === 0 || name.length === 0) continue;

    out.push({ id, name, input: block.input });
  }

  return out;
}

/** Extract tool_result blocks from a user message's content array. */
export function extractToolResultBlocks(content: unknown): ExtractedToolResultBlock[] {
  if (!Array.isArray(content)) return [];

  const out: ExtractedToolResultBlock[] = [];

  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type !== 'tool_result' && block.type !== 'mcp_tool_result') continue;

    const toolUseID = asString(block.tool_use_id);
    if (toolUseID.length === 0) continue;

    out.push({
      tool_use_id: toolUseID,
      name: asString(block.name) || undefined,
      rawContent: block.content,
      content: extractText(block.content) || undefined,
      contentJSON: jsonString(block.content),
      is_error: typeof block.is_error === 'boolean' ? block.is_error : undefined,
    });
  }

  return out;
}

export function extractInputMessages(content: unknown): Message[] {
  if (typeof content === 'string') {
    const text = content.trim();
    return text.length > 0 ? [{ role: 'user', content: text }] : [];
  }
  if (isRecord(content) && typeof content.text === 'string') {
    const text = content.text.trim();
    return text.length > 0 ? [{ role: 'user', content: text }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const messages: Message[] = [];
  let pendingUserText: string[] = [];

  const flushUserText = (): void => {
    if (pendingUserText.length === 0) {
      return;
    }
    messages.push({
      role: 'user',
      content: pendingUserText.join('\n'),
    });
    pendingUserText = [];
  };

  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.type === 'text') {
      const text = asString(item.text);
      if (text.length > 0) {
        pendingUserText.push(text);
      }
      continue;
    }

    if (item.type !== 'tool_result' && item.type !== 'mcp_tool_result') {
      continue;
    }

    flushUserText();

    const toolCallId = asString(item.tool_use_id);
    const toolName = asString(item.name) || undefined;
    if (toolCallId.length === 0) {
      continue;
    }

    const contentText = extractText(item.content) || undefined;
    const contentJSON = jsonString(item.content);
    const toolResult: ToolResultPart = {
      toolCallId,
      name: toolName,
      content: contentText,
      contentJSON,
      isError: typeof item.is_error === 'boolean' ? item.is_error : undefined,
    };
    const metadata: PartMetadata = { providerType: asString(item.type) || undefined };

    messages.push({
      role: 'tool',
      name: toolName,
      content: contentText,
      parts: [{ type: 'tool_result', toolResult, metadata }],
    });
  }

  flushUserText();
  return messages;
}

export function extractMessageLevelError(betaMessage: AnyRecord): string | undefined {
  const stopReason = asString(betaMessage.stop_reason);
  if (stopReasonMessageLevelErrors.has(stopReason)) {
    return stopReason;
  }

  const content = betaMessage.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  for (const block of content) {
    if (!isRecord(block)) continue;
    const blockType = asString(block.type);
    if (!blockType.endsWith('_error')) continue;

    const text = asString(block.error)
      || asString(block.message)
      || asString(block.text)
      || extractText(block.content)
      || blockType;
    return text;
  }

  return undefined;
}

export function extractText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (isRecord(item) && typeof item.text === 'string') return item.text.trim();
        return '';
      })
      .filter((s) => s.length > 0)
      .join('\n');
  }
  if (isRecord(value) && typeof value.text === 'string') return value.text.trim();
  return '';
}

// ---------------------------------------------------------------------------
// Shared utility helpers (exported for use by handler.ts)
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null;
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  return undefined;
}

function jsonString(value: unknown): string {
  try { return JSON.stringify(value); }
  catch { return ''; }
}
