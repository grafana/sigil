function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function decodeBase64Utf8(value: string): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(value));
  } catch {
    return null;
  }
}
