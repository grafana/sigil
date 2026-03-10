function normalizeHexIdentifier(value: string, expectedHexLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }

  if (trimmed.length === expectedHexLength && /^[0-9a-f]+$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  try {
    const binary = window.atob(trimmed);
    if (binary.length * 2 !== expectedHexLength) {
      return trimmed;
    }
    return Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  } catch {
    return trimmed;
  }
}

export function normalizeTraceID(traceID: string | undefined): string {
  return normalizeHexIdentifier(traceID ?? '', 32);
}

export function normalizeSpanID(spanID: string | undefined): string {
  return normalizeHexIdentifier(spanID ?? '', 16);
}
