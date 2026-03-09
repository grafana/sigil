import { formatToolContent, parseToolContent } from './formatContent';

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes));
}

function encodeBinaryBase64(size: number): string {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = i % 256;
  }
  return btoa(String.fromCharCode(...bytes));
}

describe('formatToolContent', () => {
  it('decodes UTF-8 JSON payloads before pretty-printing', () => {
    const encoded = encodeUtf8Base64('{"message":"café ☕"}');

    expect(formatToolContent(encoded)).toBe('{\n  "message": "café ☕"\n}');
  });

  it('keeps binary payloads as a placeholder', () => {
    const encoded = encodeBinaryBase64(1434);

    expect(formatToolContent(encoded)).toBe('[binary data, ~1.4 KB]');
  });
});

describe('parseToolContent', () => {
  it('returns json kind for valid JSON', () => {
    const result = parseToolContent('{"key":"value"}');

    expect(result).toEqual({
      kind: 'json',
      formatted: '{\n  "key": "value"\n}',
    });
  });

  it('returns text kind for plain text', () => {
    const result = parseToolContent('just some text');

    expect(result).toEqual({ kind: 'text', content: 'just some text' });
  });

  it('unwraps content blocks with plain text', () => {
    const input = JSON.stringify([
      {
        text: 'Found 4 datasources:\n- uid=abc | name=logs | type=loki\n- uid=def | name=metrics | type=prom',
        type: 'text',
      },
    ]);

    const result = parseToolContent(input);

    expect(result.kind).toBe('text');
    expect((result as { kind: 'text'; content: string }).content).toContain('Found 4 datasources:');
  });

  it('unwraps content blocks containing JSON text', () => {
    const inner = JSON.stringify({ results: [{ signal: 'logs', count: 42 }] });
    const input = JSON.stringify([{ text: inner, type: 'text' }]);

    const result = parseToolContent(input);

    expect(result.kind).toBe('json');
    const formatted = (result as { kind: 'json'; formatted: string }).formatted;
    expect(formatted).toContain('"signal": "logs"');
    expect(formatted).toContain('"count": 42');
  });

  it('joins multiple content blocks', () => {
    const input = JSON.stringify([
      { text: 'Line one', type: 'text' },
      { text: 'Line two', type: 'text' },
    ]);

    const result = parseToolContent(input);

    expect(result).toEqual({ kind: 'text', content: 'Line one\nLine two' });
  });

  it('does not unwrap arrays that are not content blocks', () => {
    const input = JSON.stringify([{ id: 1 }, { id: 2 }]);

    const result = parseToolContent(input);

    expect(result.kind).toBe('json');
  });

  it('expands nested JSON strings', () => {
    const input = JSON.stringify({ data: '{"nested": true}' });

    const result = parseToolContent(input);

    expect(result.kind).toBe('json');
    const formatted = (result as { kind: 'json'; formatted: string }).formatted;
    expect(formatted).toContain('"nested": true');
    expect(formatted).not.toContain('\\"nested\\"');
  });
});
