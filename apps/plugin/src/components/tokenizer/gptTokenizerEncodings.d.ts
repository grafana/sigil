declare module 'gpt-tokenizer/esm/encoding/o200k_base' {
  export function encode(text: string): number[];
  export function decode(tokens: number[]): string;
}

declare module 'gpt-tokenizer/esm/encoding/cl100k_base' {
  export function encode(text: string): number[];
  export function decode(tokens: number[]): string;
}

declare module 'gpt-tokenizer/esm/encoding/p50k_base' {
  export function encode(text: string): number[];
  export function decode(tokens: number[]): string;
}

declare module 'gpt-tokenizer/esm/encoding/r50k_base' {
  export function encode(text: string): number[];
  export function decode(tokens: number[]): string;
}
