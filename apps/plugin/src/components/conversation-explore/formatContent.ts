import { decodeBase64Utf8 } from '../../conversation/base64';

const BASE64_RE = /^[A-Za-z0-9+/\n\r]+=*$/;

function looksLikeBase64(value: string): boolean {
  return value.length >= 64 && BASE64_RE.test(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type ParsedToolContent =
  | { kind: 'json'; formatted: string }
  | { kind: 'binary'; label: string }
  | { kind: 'text'; content: string };

/**
 * Recursively expand string values that contain JSON.
 * Tool results often wrap structured data inside a JSON string
 * (e.g. `[{"text": "{\"results\":[...]}"}]`). Expanding nested
 * JSON makes the output much more readable.
 */
function expandNestedJson(value: unknown, depth = 0): unknown {
  if (depth > 3) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 50_000) {
      return value;
    }
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return expandNestedJson(JSON.parse(value), depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => expandNestedJson(v, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = expandNestedJson(v, depth + 1);
    }
    return result;
  }

  return value;
}

/**
 * Detect MCP-style content-block arrays: [{text: "...", type: "text"}, ...].
 * These are transport envelopes — the user cares about the inner text, not
 * the wrapper.
 */
function isTextContentBlockArray(value: unknown): value is Array<{ text: string; type: string }> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).text === 'string' &&
        (item as Record<string, unknown>).type === 'text'
    )
  );
}

/**
 * Parse a single text payload: if it's JSON, return highlighted JSON;
 * otherwise return plain text.
 */
function parseTextPayload(text: string): ParsedToolContent {
  try {
    const parsed = JSON.parse(text);
    const expanded = expandNestedJson(parsed);
    return { kind: 'json', formatted: JSON.stringify(expanded, null, 2) };
  } catch {
    return { kind: 'text', content: text };
  }
}

/**
 * Parse tool call arguments / tool result content into a typed result
 * so callers can render JSON with syntax highlighting vs plain text.
 *
 * Unwraps MCP-style content blocks (`[{text, type: "text"}]`) so the
 * user sees the actual content rather than the transport envelope.
 */
export function parseToolContent(value: string): ParsedToolContent {
  const decoded = decodeBase64Utf8(value);

  if (decoded === null && looksLikeBase64(value)) {
    const approxBytes = Math.floor((value.length * 3) / 4);
    return { kind: 'binary', label: `[binary data, ~${formatBytes(approxBytes)}]` };
  }

  const raw = decoded ?? value;

  try {
    const parsed = JSON.parse(raw);

    if (isTextContentBlockArray(parsed)) {
      const innerText = parsed.map((block) => block.text).join('\n');
      return parseTextPayload(innerText);
    }

    const expanded = expandNestedJson(parsed);
    return { kind: 'json', formatted: JSON.stringify(expanded, null, 2) };
  } catch {
    return { kind: 'text', content: raw };
  }
}
