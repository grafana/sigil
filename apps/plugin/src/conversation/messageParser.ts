import type { Message, MessageRole, Part, ToolCallPart, ToolResultPart } from './types';

export function decodeBase64Json(encoded: string): string {
  try {
    return atob(encoded);
  } catch {
    return encoded;
  }
}

export function humanizeRole(role: MessageRole): string {
  switch (role) {
    case 'MESSAGE_ROLE_USER':
      return 'User';
    case 'MESSAGE_ROLE_ASSISTANT':
      return 'Assistant';
    case 'MESSAGE_ROLE_TOOL':
      return 'Tool';
    default:
      return 'Unknown';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const validRoles = new Set<string>(['MESSAGE_ROLE_USER', 'MESSAGE_ROLE_ASSISTANT', 'MESSAGE_ROLE_TOOL']);

function parseToolCall(raw: unknown): ToolCallPart | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const id = typeof raw.id === 'string' ? raw.id : '';
  const name = typeof raw.name === 'string' ? raw.name : '';
  if (id.length === 0 && name.length === 0) {
    return undefined;
  }
  const part: ToolCallPart = { id, name };
  if (typeof raw.input_json === 'string' && raw.input_json.length > 0) {
    part.input_json = decodeBase64Json(raw.input_json);
  }
  return part;
}

function parseToolResult(raw: unknown): ToolResultPart | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const toolCallId = typeof raw.tool_call_id === 'string' ? raw.tool_call_id : '';
  const name = typeof raw.name === 'string' ? raw.name : '';
  const part: ToolResultPart = { tool_call_id: toolCallId, name };
  if (typeof raw.content === 'string') {
    part.content = raw.content;
  }
  if (typeof raw.content_json === 'string' && raw.content_json.length > 0) {
    part.content_json = decodeBase64Json(raw.content_json);
  }
  if (typeof raw.is_error === 'boolean') {
    part.is_error = raw.is_error;
  }
  return part;
}

function parsePart(raw: unknown): Part | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const part: Part = {};
  let hasPayload = false;

  if (isRecord(raw.metadata) && typeof raw.metadata.provider_type === 'string') {
    part.metadata = { provider_type: raw.metadata.provider_type };
  }

  if (typeof raw.text === 'string') {
    part.text = raw.text;
    hasPayload = true;
  }
  if (typeof raw.thinking === 'string') {
    part.thinking = raw.thinking;
    hasPayload = true;
  }
  if (raw.tool_call !== undefined) {
    const toolCall = parseToolCall(raw.tool_call);
    if (toolCall) {
      part.tool_call = toolCall;
      hasPayload = true;
    }
  }
  if (raw.tool_result !== undefined) {
    const toolResult = parseToolResult(raw.tool_result);
    if (toolResult) {
      part.tool_result = toolResult;
      hasPayload = true;
    }
  }

  return hasPayload ? part : undefined;
}

function parseMessage(raw: unknown): Message | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const role = typeof raw.role === 'string' ? raw.role : '';
  if (!validRoles.has(role)) {
    return undefined;
  }

  const rawParts = Array.isArray(raw.parts) ? raw.parts : [];
  const parts: Part[] = [];
  for (const rawPart of rawParts) {
    const parsed = parsePart(rawPart);
    if (parsed) {
      parts.push(parsed);
    }
  }

  if (parts.length === 0) {
    return undefined;
  }

  const message: Message = { role: role as MessageRole, parts };
  if (typeof raw.name === 'string' && raw.name.length > 0) {
    message.name = raw.name;
  }
  return message;
}

export function parseMessages(raw: unknown[] | undefined | null): Message[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const messages: Message[] = [];
  for (const item of raw) {
    const parsed = parseMessage(item);
    if (parsed) {
      messages.push(parsed);
    }
  }
  return messages;
}

export function formatJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
