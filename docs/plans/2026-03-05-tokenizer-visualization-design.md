# Tokenizer Visualization Design

**Date:** 2026-03-05
**Status:** Approved

## Goal

Add colorful token boundary visualization to GenerationView, allowing users to see how text is tokenized by the model's BPE tokenizer. Inline toggle on existing text sections (system prompt, input, output) with auto-detected encoding and manual override.

## Library

**gpt-tokenizer** — pure JS, smallest bundle, fastest, supports all OpenAI encodings (`o200k_base`, `cl100k_base`, etc.). Lazy-loaded per encoding on toggle click (zero initial bundle cost). Anthropic models use `cl100k_base` as a visual approximation.

## Components

### `TokenizedText`

- Props: `text: string`, `encoding: EncodingName`
- Calls `encode()` from the loaded tokenizer, maps tokens back to text segments
- Renders each token as a `<span>` with `background-color: palette[index % palette.length]`
- On hover, shows Grafana `Tooltip` with the token integer ID
- Color palette: ~10 distinguishable low-opacity background colors, theme-aware (dark/light)

### `TokenizeToggle`

- Small icon button rendered in the `Section` header (next to the token count text)
- Toggles tokenized view on/off for that section
- When active, shows a small encoding dropdown (`o200k_base`, `cl100k_base`, etc.) for manual override

### `useTokenizer` hook

- Takes an `EncodingName`, returns `{ encode, isLoading }`
- Lazy-loads the encoding via dynamic `import('gpt-tokenizer/encoding/<name>')`
- Caches the loaded module in a ref so subsequent toggles are instant
- Returns `isLoading: true` while the encoding data is being fetched

## Encoding Auto-Detection

```ts
function getEncoding(provider?: string, model?: string): EncodingName {
  if (provider === 'openai') {
    // cl100k models: gpt-4, gpt-3.5-turbo
    if (model?.startsWith('gpt-4-') || model?.startsWith('gpt-3.5')) {
      return 'cl100k_base';
    }
    // All modern OpenAI: gpt-4o, gpt-5, o1, o3, o4, gpt-4.1
    return 'o200k_base';
  }
  // Anthropic, Bedrock, Google, etc. — cl100k_base as approximation
  return 'cl100k_base';
}
```

## Integration in GenerationView

The `Section` component receives an optional `onTokenize` callback and `tokenized` state. When `tokenized` is true, children render via `TokenizedText` instead of plain text.

Sections that get tokenization:
- **System Prompt** (from `generation.system_prompt`)
- **Input** (text and thinking parts from input messages)
- **Output** (text and thinking parts from output messages)

Tool call/result parts are **not** tokenized (they contain structured JSON, not natural language).

## Token Coloring

Palette cycles through ~10 colors with low opacity for readability:

```ts
const TOKEN_PALETTE = [
  'oklch(0.75 0.15 30)',   // coral
  'oklch(0.75 0.15 90)',   // gold
  'oklch(0.75 0.15 150)',  // green
  'oklch(0.75 0.15 210)',  // teal
  'oklch(0.75 0.15 270)',  // blue
  'oklch(0.75 0.15 330)',  // pink
  'oklch(0.70 0.12 60)',   // amber
  'oklch(0.70 0.12 120)',  // lime
  'oklch(0.70 0.12 180)',  // cyan
  'oklch(0.70 0.12 240)',  // indigo
];
```

Background opacity ~0.25 for dark theme, ~0.35 for light theme.

## File Structure

```
apps/plugin/src/components/tokenizer/
  TokenizedText.tsx        # Core colored token rendering
  TokenizedText.styles.ts  # Styles
  useTokenizer.ts          # Lazy-load hook
  encodingMap.ts           # Provider/model -> encoding mapping
  palette.ts               # Color palette constants
```

Modifications to existing files:
- `GenerationView.tsx` — add toggle state, pass to Section, wrap PartContent
- `GenerationView.styles.ts` — toggle button styles

## Bundle Impact

- Zero cost at initial page load (encoding data lazy-loaded on toggle click)
- Each encoding: ~1-2MB BPE rank data, loaded once and cached in memory
- `gpt-tokenizer` core: ~5KB minified

## Storybook

Add `TokenizedText.stories.tsx` showing:
- Short text tokenized with different encodings
- Long text with many tokens
- Dark/light theme variants
