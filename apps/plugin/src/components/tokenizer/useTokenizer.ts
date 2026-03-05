import { useEffect, useRef, useState } from 'react';
import type { EncodingName } from './encodingMap';

type EncodeFn = (text: string) => number[];
type DecodeFn = (tokens: number[]) => string;

export type TokenizerModule = {
  encode: EncodeFn;
  decode: DecodeFn;
};

const moduleCache = new Map<EncodingName, TokenizerModule>();

async function loadEncoding(name: EncodingName): Promise<TokenizerModule> {
  const cached = moduleCache.get(name);
  if (cached) {
    return cached;
  }

  let mod: TokenizerModule;
  switch (name) {
    case 'o200k_base':
      mod = await import('gpt-tokenizer/esm/encoding/o200k_base');
      break;
    case 'cl100k_base':
      mod = await import('gpt-tokenizer/esm/encoding/cl100k_base');
      break;
    case 'p50k_base':
      mod = await import('gpt-tokenizer/esm/encoding/p50k_base');
      break;
    case 'r50k_base':
      mod = await import('gpt-tokenizer/esm/encoding/r50k_base');
      break;
    default:
      mod = await import('gpt-tokenizer/esm/encoding/cl100k_base');
  }

  moduleCache.set(name, mod);
  return mod;
}

export function useTokenizer(encoding: EncodingName | null): {
  encode: EncodeFn | undefined;
  decode: DecodeFn | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  // Derive initial state synchronously from cache — no effect needed for cached/null cases
  const cached = encoding ? moduleCache.get(encoding) : undefined;
  const [asyncResult, setAsyncResult] = useState<
    { key: EncodingName; mod: TokenizerModule; error: null } | { key: EncodingName; mod: null; error: Error } | null
  >(null);
  const activeEncoding = useRef(encoding);

  useEffect(() => {
    activeEncoding.current = encoding;

    // Nothing to load: null encoding or already cached
    if (encoding === null || moduleCache.has(encoding)) {
      return;
    }

    let cancelled = false;
    loadEncoding(encoding)
      .then((loaded) => {
        if (!cancelled && activeEncoding.current === encoding) {
          setAsyncResult({ key: encoding, mod: loaded, error: null });
        }
      })
      .catch((err) => {
        if (!cancelled && activeEncoding.current === encoding) {
          const e = err instanceof Error ? err : new Error(String(err));
          console.error(`Failed to load tokenizer encoding "${encoding}":`, e);
          setAsyncResult({ key: encoding, mod: null, error: e });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [encoding]);

  // Resolve the module: prefer cache (always fresh), fall back to async result
  const matchingResult = asyncResult && asyncResult.key === encoding ? asyncResult : null;
  const mod = cached ?? matchingResult?.mod ?? undefined;
  const error = mod ? null : (matchingResult?.error ?? null);
  const isLoading = encoding !== null && !mod && !error;

  return { encode: mod?.encode, decode: mod?.decode, isLoading, error };
}
