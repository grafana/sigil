import { formatToolContent } from './formatContent';

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
