import { decodeBase64Utf8 } from '../../conversation/base64';

const BASE64_RE = /^[A-Za-z0-9+/\n\r]+=*$/;

function looksLikeBase64(value: string): boolean {
  return value.length >= 64 && BASE64_RE.test(value);
}

function tryPrettyJSON(value: string): string | null {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return null;
  }
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

/**
 * Best-effort formatting for tool call arguments / tool result content.
 * Decodes base64 when possible, pretty-prints JSON, and replaces
 * undecodable binary blobs with a human-readable placeholder.
 */
export function formatToolContent(value: string): string {
  const decoded = decodeBase64Utf8(value);
  if (decoded !== null) {
    return tryPrettyJSON(decoded) ?? decoded;
  }

  if (looksLikeBase64(value)) {
    const approxBytes = Math.floor((value.length * 3) / 4);
    return `[binary data, ~${formatBytes(approxBytes)}]`;
  }

  return tryPrettyJSON(value) ?? value;
}
