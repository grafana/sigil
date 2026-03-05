import { renderHook, waitFor } from '@testing-library/react';
import { useTokenizer } from './useTokenizer';

jest.mock(
  'gpt-tokenizer/esm/encoding/cl100k_base',
  () => ({
    encode: (text: string) => [1, 2, 3],
    decode: (tokens: number[]) => 'decoded',
  }),
  { virtual: true }
);

describe('useTokenizer', () => {
  it('returns loading state initially, then resolves', async () => {
    const { result } = renderHook(() => useTokenizer('cl100k_base'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.encode).toBeDefined();
    expect(result.current.decode).toBeDefined();
  });

  it('returns undefined encode when encoding is null', () => {
    const { result } = renderHook(() => useTokenizer(null));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.encode).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});
