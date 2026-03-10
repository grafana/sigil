# Tokenizer Visualization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add colorful inline token boundary visualization to GenerationView sections with auto-detected encoding and manual override.

**Architecture:** `gpt-tokenizer` with lazy-loaded encodings, a `TokenizedText` component rendering colored spans with hover tooltips, integrated into the existing `Section`/`PartContent` components in GenerationView via toggle buttons.

**Tech Stack:** gpt-tokenizer, React, Emotion CSS, Grafana UI (Tooltip, Icon, Select), Jest

---

### Task 1: Install gpt-tokenizer

**Files:**
- Modify: `apps/plugin/package.json`

**Step 1: Install the dependency**

Run: `pnpm add gpt-tokenizer --filter grafana-sigil-app`
Expected: package.json updated, lockfile updated

**Step 2: Commit**

```bash
git add apps/plugin/package.json pnpm-lock.yaml
git commit -m "feat(plugin): add gpt-tokenizer dependency for token visualization"
```

---

### Task 2: Create encoding map utility

**Files:**
- Create: `apps/plugin/src/components/tokenizer/encodingMap.ts`
- Create: `apps/plugin/src/components/tokenizer/encodingMap.test.ts`

**Step 1: Write the test**

```ts
// apps/plugin/src/components/tokenizer/encodingMap.test.ts
import { getEncoding, type EncodingName, AVAILABLE_ENCODINGS } from './encodingMap';

describe('getEncoding', () => {
  const cases: Array<{ provider?: string; model?: string; expected: EncodingName }> = [
    { provider: 'openai', model: 'gpt-4o', expected: 'o200k_base' },
    { provider: 'openai', model: 'gpt-4o-mini', expected: 'o200k_base' },
    { provider: 'openai', model: 'gpt-5', expected: 'o200k_base' },
    { provider: 'openai', model: 'gpt-5.2', expected: 'o200k_base' },
    { provider: 'openai', model: 'o1', expected: 'o200k_base' },
    { provider: 'openai', model: 'o3', expected: 'o200k_base' },
    { provider: 'openai', model: 'o4-mini', expected: 'o200k_base' },
    { provider: 'openai', model: 'gpt-4.1', expected: 'o200k_base' },
    { provider: 'openai', model: 'gpt-4-turbo', expected: 'cl100k_base' },
    { provider: 'openai', model: 'gpt-4-0613', expected: 'cl100k_base' },
    { provider: 'openai', model: 'gpt-3.5-turbo', expected: 'cl100k_base' },
    { provider: 'anthropic', model: 'claude-sonnet-4-5', expected: 'cl100k_base' },
    { provider: 'bedrock', model: 'claude-haiku-4-5-20251001', expected: 'cl100k_base' },
    { provider: 'google', model: 'gemini-pro', expected: 'cl100k_base' },
    { provider: undefined, model: undefined, expected: 'cl100k_base' },
  ];

  it.each(cases)('returns $expected for $provider/$model', ({ provider, model, expected }) => {
    expect(getEncoding(provider, model)).toBe(expected);
  });
});

describe('AVAILABLE_ENCODINGS', () => {
  it('contains the expected encodings', () => {
    expect(AVAILABLE_ENCODINGS.map((e) => e.value)).toEqual(
      expect.arrayContaining(['o200k_base', 'cl100k_base'])
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter grafana-sigil-app jest -- --testPathPattern=encodingMap --no-coverage`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```ts
// apps/plugin/src/components/tokenizer/encodingMap.ts
export type EncodingName = 'o200k_base' | 'cl100k_base' | 'p50k_base' | 'r50k_base';

export const AVAILABLE_ENCODINGS: Array<{ label: string; value: EncodingName }> = [
  { label: 'o200k (GPT-4o, GPT-5, o1–o4)', value: 'o200k_base' },
  { label: 'cl100k (GPT-4, GPT-3.5, Claude approx)', value: 'cl100k_base' },
  { label: 'p50k (Codex, text-davinci)', value: 'p50k_base' },
  { label: 'r50k (GPT-3)', value: 'r50k_base' },
];

/**
 * Auto-detect the most appropriate BPE encoding for a given provider/model.
 * OpenAI modern models use o200k_base; older GPT-4/3.5 use cl100k_base.
 * Non-OpenAI providers fall back to cl100k_base as a visual approximation.
 */
export function getEncoding(provider?: string, model?: string): EncodingName {
  const p = provider?.trim().toLowerCase() ?? '';
  const m = model?.trim().toLowerCase() ?? '';

  if (p === 'openai') {
    // Legacy cl100k models: gpt-4 (non-o), gpt-3.5
    if (/^gpt-4[^o.]/.test(m) || m.startsWith('gpt-3.5')) {
      return 'cl100k_base';
    }
    return 'o200k_base';
  }

  return 'cl100k_base';
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter grafana-sigil-app jest -- --testPathPattern=encodingMap --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/plugin/src/components/tokenizer/encodingMap.ts apps/plugin/src/components/tokenizer/encodingMap.test.ts
git commit -m "feat(plugin): add encoding auto-detection for tokenizer visualization"
```

---

### Task 3: Create palette constants

**Files:**
- Create: `apps/plugin/src/components/tokenizer/palette.ts`

**Step 1: Create the palette file**

```ts
// apps/plugin/src/components/tokenizer/palette.ts

/**
 * Token background colors — 10 hues evenly distributed, designed for
 * legibility on both dark and light Grafana themes.
 * Used as: background with ~0.25 (dark) or ~0.35 (light) opacity.
 */
export const TOKEN_COLORS = [
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
] as const;

export function tokenColor(index: number): string {
  return TOKEN_COLORS[index % TOKEN_COLORS.length];
}
```

No test needed — pure constants. Will be validated visually in Storybook.

**Step 2: Commit**

```bash
git add apps/plugin/src/components/tokenizer/palette.ts
git commit -m "feat(plugin): add token color palette for visualization"
```

---

### Task 4: Create useTokenizer hook

**Files:**
- Create: `apps/plugin/src/components/tokenizer/useTokenizer.ts`
- Create: `apps/plugin/src/components/tokenizer/useTokenizer.test.ts`

**Step 1: Write the test**

```ts
// apps/plugin/src/components/tokenizer/useTokenizer.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { useTokenizer } from './useTokenizer';

// Mock the dynamic import
jest.mock('gpt-tokenizer/encoding/cl100k_base', () => ({
  encode: (text: string) => [1, 2, 3],
  decode: (tokens: number[]) => 'decoded',
}), { virtual: true });

describe('useTokenizer', () => {
  it('returns loading state initially, then resolves', async () => {
    const { result } = renderHook(() => useTokenizer('cl100k_base'));

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.encode).toBeUndefined();

    // After load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.encode).toBeDefined();
  });

  it('returns undefined encode when encoding is null', () => {
    const { result } = renderHook(() => useTokenizer(null));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.encode).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter grafana-sigil-app jest -- --testPathPattern=useTokenizer --no-coverage`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```ts
// apps/plugin/src/components/tokenizer/useTokenizer.ts
import { useEffect, useRef, useState } from 'react';
import type { EncodingName } from './encodingMap';

type EncodeFn = (text: string) => number[];

type TokenizerModule = {
  encode: EncodeFn;
  decode: (tokens: number[]) => string;
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
      mod = await import('gpt-tokenizer/encoding/o200k_base');
      break;
    case 'cl100k_base':
      mod = await import('gpt-tokenizer/encoding/cl100k_base');
      break;
    case 'p50k_base':
      mod = await import('gpt-tokenizer/encoding/p50k_base');
      break;
    case 'r50k_base':
      mod = await import('gpt-tokenizer/encoding/r50k_base');
      break;
    default:
      mod = await import('gpt-tokenizer/encoding/cl100k_base');
  }

  moduleCache.set(name, mod);
  return mod;
}

export function useTokenizer(encoding: EncodingName | null): {
  encode: EncodeFn | undefined;
  isLoading: boolean;
} {
  const [mod, setMod] = useState<TokenizerModule | undefined>(
    encoding ? moduleCache.get(encoding) : undefined
  );
  const [isLoading, setIsLoading] = useState(encoding !== null && !moduleCache.has(encoding));
  const activeEncoding = useRef(encoding);

  useEffect(() => {
    activeEncoding.current = encoding;
    if (encoding === null) {
      setMod(undefined);
      setIsLoading(false);
      return;
    }

    const cached = moduleCache.get(encoding);
    if (cached) {
      setMod(cached);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    loadEncoding(encoding).then((loaded) => {
      if (activeEncoding.current === encoding) {
        setMod(loaded);
        setIsLoading(false);
      }
    });
  }, [encoding]);

  return { encode: mod?.encode, isLoading };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter grafana-sigil-app jest -- --testPathPattern=useTokenizer --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/plugin/src/components/tokenizer/useTokenizer.ts apps/plugin/src/components/tokenizer/useTokenizer.test.ts
git commit -m "feat(plugin): add useTokenizer hook with lazy encoding loading"
```

---

### Task 5: Create TokenizedText component

**Files:**
- Create: `apps/plugin/src/components/tokenizer/TokenizedText.tsx`
- Create: `apps/plugin/src/components/tokenizer/TokenizedText.styles.ts`
- Create: `apps/plugin/src/components/tokenizer/TokenizedText.test.tsx`

**Step 1: Write the test**

```ts
// apps/plugin/src/components/tokenizer/TokenizedText.test.tsx
import { render, screen } from '@testing-library/react';
import { TokenizedText } from './TokenizedText';

// Provide a mock encode that splits on spaces for predictable testing
const mockEncode = jest.fn((text: string) => text.split(' ').map((_, i) => i + 100));
const mockDecode = jest.fn((tokens: number[]) => tokens.map((t) => `tok${t}`).join(''));

jest.mock('gpt-tokenizer/encoding/cl100k_base', () => ({
  encode: (text: string) => text.split(' ').map((_, i) => i + 100),
  decode: (tokens: number[]) => tokens.map((t) => `tok${t}`).join(''),
  encodeChat: jest.fn(),
}), { virtual: true });

describe('TokenizedText', () => {
  it('renders text in colored spans when encode is provided', () => {
    const encode = (text: string) => {
      // Return token IDs that map to 3-char segments
      const tokens: number[] = [];
      for (let i = 0; i < text.length; i += 3) {
        tokens.push(i);
      }
      return tokens;
    };

    const { container } = render(
      <TokenizedText text="Hello world" encode={encode} />
    );

    const spans = container.querySelectorAll('[data-token-id]');
    expect(spans.length).toBeGreaterThan(0);
  });

  it('renders plain text when encode is undefined', () => {
    const { container } = render(
      <TokenizedText text="Hello world" encode={undefined} />
    );

    expect(container.textContent).toBe('Hello world');
    expect(container.querySelectorAll('[data-token-id]').length).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter grafana-sigil-app jest -- --testPathPattern=TokenizedText.test --no-coverage`
Expected: FAIL — module not found

**Step 3: Write the styles**

```ts
// apps/plugin/src/components/tokenizer/TokenizedText.styles.ts
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';

export const getStyles = (theme: GrafanaTheme2) => {
  const bgOpacity = theme.isDark ? 0.25 : 0.35;

  return {
    container: css({
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      lineHeight: 1.6,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    token: css({
      borderRadius: 2,
      padding: '1px 0',
      cursor: 'default',
      transition: 'outline 100ms ease',
      '&:hover': {
        outline: `1px solid ${theme.colors.border.medium}`,
        outlineOffset: -1,
      },
    }),
    bgOpacity: String(bgOpacity),
  };
};
```

**Step 4: Write the component**

```tsx
// apps/plugin/src/components/tokenizer/TokenizedText.tsx
import React, { useMemo } from 'react';
import { Tooltip, useStyles2 } from '@grafana/ui';
import { tokenColor } from './palette';
import { getStyles } from './TokenizedText.styles';

type Props = {
  text: string;
  encode: ((text: string) => number[]) | undefined;
};

type TokenSegment = {
  text: string;
  id: number;
  index: number;
};

function tokenize(text: string, encode: (text: string) => number[]): TokenSegment[] {
  const tokenIds = encode(text);
  const segments: TokenSegment[] = [];
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);

  // gpt-tokenizer's encode returns token IDs. We need to map them back to
  // text positions. We re-encode character by character to find boundaries.
  // A simpler approach: use the byte length of each token to slice the text.
  // gpt-tokenizer exposes `decode` per token, but we can also use
  // encodeGenerator or just walk the text by decoding each token.

  // Practical approach: decode each token individually to get its text.
  // Import decode dynamically alongside encode — but we only have encode here.
  // Instead, use a positional approach with the full encode result.

  // Simplest correct approach: encode the full text, then for each token,
  // decode it to get its string representation. Since we only have `encode`,
  // we use a sliding window: encode prefixes of increasing length and diff.
  let pos = 0;
  for (let i = 0; i < tokenIds.length; i++) {
    // Find how many characters this token covers by encoding incrementally
    // This is expensive for long texts. Better approach: use bytePairEncode
    // or just estimate by encoding substrings.

    // Fast heuristic: encode text[0..pos+1], text[0..pos+2], ... until we get
    // i+1 tokens. But this is O(n^2). For a visualization feature this is
    // acceptable for texts up to ~10k chars.
    let end = pos + 1;
    while (end <= text.length) {
      const subTokens = encode(text.slice(0, end));
      if (subTokens.length > i + 1 || end === text.length) {
        if (subTokens.length > i + 1) {
          end--;
        }
        break;
      }
      end++;
    }
    // Ensure we make progress
    if (end <= pos) {
      end = pos + 1;
    }
    segments.push({ text: text.slice(pos, end), id: tokenIds[i], index: i });
    pos = end;
  }

  // Capture any remaining text
  if (pos < text.length) {
    segments.push({ text: text.slice(pos), id: -1, index: segments.length });
  }

  return segments;
}

export function TokenizedText({ text, encode }: Props) {
  const styles = useStyles2(getStyles);

  const segments = useMemo(() => {
    if (!encode) {
      return null;
    }
    return tokenize(text, encode);
  }, [text, encode]);

  if (!segments) {
    return <span className={styles.container}>{text}</span>;
  }

  return (
    <span className={styles.container}>
      {segments.map((seg, i) => (
        <Tooltip key={i} content={`Token ID: ${seg.id}`} placement="top">
          <span
            className={styles.token}
            data-token-id={seg.id}
            style={{ backgroundColor: `color-mix(in oklch, ${tokenColor(seg.index)}, transparent ${Math.round((1 - parseFloat(styles.bgOpacity)) * 100)}%)` }}
          >
            {seg.text}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
```

> **NOTE to implementor:** The `tokenize` function above uses a naive O(n^2) approach for mapping token IDs back to text positions. Before implementing, check if `gpt-tokenizer` exposes a `decode(tokenId[])` or per-token decode function that would let you simply decode each token to get its text, which is O(n). The library does export `decode` — use it:
>
> ```ts
> // Better approach if decode is available:
> function tokenize(text: string, encode: (t: string) => number[], decode: (ids: number[]) => string): TokenSegment[] {
>   const tokenIds = encode(text);
>   const segments: TokenSegment[] = [];
>   let pos = 0;
>   for (let i = 0; i < tokenIds.length; i++) {
>     const decoded = decode([tokenIds[i]]);
>     segments.push({ text: decoded, id: tokenIds[i], index: i });
>     pos += decoded.length;
>   }
>   return segments;
> }
> ```
>
> Verify which functions `gpt-tokenizer/encoding/<name>` actually exports and use the simplest correct approach.

**Step 5: Run test to verify it passes**

Run: `pnpm --filter grafana-sigil-app jest -- --testPathPattern=TokenizedText.test --no-coverage`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/plugin/src/components/tokenizer/TokenizedText.tsx apps/plugin/src/components/tokenizer/TokenizedText.styles.ts apps/plugin/src/components/tokenizer/TokenizedText.test.tsx
git commit -m "feat(plugin): add TokenizedText component with colored token spans"
```

---

### Task 6: Integrate tokenizer toggle into GenerationView

**Files:**
- Modify: `apps/plugin/src/components/conversation-explore/GenerationView.tsx`
- Modify: `apps/plugin/src/components/conversation-explore/GenerationView.styles.ts`

**Step 1: Add styles for the toggle and encoding selector**

Add to the end of the styles object in `GenerationView.styles.ts`:

```ts
  tokenizeBtn: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.375),
    marginLeft: 'auto',
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    fontSize: 10,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    background: 'transparent',
    border: `1px solid ${theme.colors.border.weak}`,
    cursor: 'pointer',
    transition: 'all 120ms ease',
    '&:hover': {
      color: theme.colors.text.primary,
      borderColor: theme.colors.border.medium,
      background: theme.colors.action.hover,
    },
  }),
  tokenizeBtnActive: css({
    color: theme.colors.primary.text,
    borderColor: theme.colors.primary.border,
    background: theme.colors.primary.transparent,
  }),
  encodingSelect: css({
    marginLeft: theme.spacing(0.5),
    '& > div': {
      minHeight: 22,
      fontSize: 10,
    },
  }),
```

**Step 2: Update GenerationView to add toggle state and pass to sections**

Add imports at the top of `GenerationView.tsx`:

```ts
import { TokenizedText } from '../tokenizer/TokenizedText';
import { useTokenizer } from '../tokenizer/useTokenizer';
import { getEncoding, AVAILABLE_ENCODINGS, type EncodingName } from '../tokenizer/encodingMap';
```

Add state inside the `GenerationView` component (after the existing `useMemo` calls):

```ts
const autoEncoding = useMemo(
  () => getEncoding(gen?.model?.provider, gen?.model?.name),
  [gen?.model?.provider, gen?.model?.name]
);
const [tokenizedSections, setTokenizedSections] = useState<Record<string, boolean>>({});
const [encodingOverride, setEncodingOverride] = useState<EncodingName | null>(null);
const activeEncoding = encodingOverride ?? autoEncoding;
const anyTokenized = Object.values(tokenizedSections).some(Boolean);
const { encode, isLoading: tokenizerLoading } = useTokenizer(anyTokenized ? activeEncoding : null);

const toggleSection = useCallback((key: string) => {
  setTokenizedSections((prev) => ({ ...prev, [key]: !prev[key] }));
}, []);
```

**Step 3: Update the Section component to accept tokenize props**

Add props to the `Section` component:

```ts
function Section({
  title,
  count,
  defaultExpanded = true,
  sectionKey,
  tokenized,
  onToggleTokenize,
  encodingOverride,
  onEncodingChange,
  tokenizerLoading,
  children,
}: {
  title: string;
  count?: string;
  defaultExpanded?: boolean;
  sectionKey?: string;
  tokenized?: boolean;
  onToggleTokenize?: () => void;
  encodingOverride?: EncodingName | null;
  onEncodingChange?: (encoding: EncodingName) => void;
  tokenizerLoading?: boolean;
  children: React.ReactNode;
}) {
```

Add the toggle button inside the `sectionHeader` div, after the count span:

```tsx
{onToggleTokenize && (
  <span
    className={cx(styles.tokenizeBtn, tokenized && styles.tokenizeBtnActive)}
    onClick={(e) => { e.stopPropagation(); onToggleTokenize(); }}
    role="button"
    tabIndex={0}
  >
    <Icon name="brackets-curly" size="xs" />
    {tokenizerLoading ? 'Loading…' : 'Tokenize'}
  </span>
)}
{tokenized && onEncodingChange && (
  <div className={styles.encodingSelect} onClick={(e) => e.stopPropagation()}>
    <select
      value={encodingOverride ?? ''}
      onChange={(e) => onEncodingChange((e.target.value || undefined) as EncodingName)}
      style={{ fontSize: 10, padding: '2px 4px', background: 'transparent', border: `1px solid ${theme.colors.border.weak}`, borderRadius: 4, color: theme.colors.text.secondary }}
    >
      <option value="">Auto</option>
      {AVAILABLE_ENCODINGS.map((enc) => (
        <option key={enc.value} value={enc.value}>{enc.label}</option>
      ))}
    </select>
  </div>
)}
```

> **Note:** `Section` needs `useTheme2` from `@grafana/ui` to access `theme.colors` for the inline `select` styling. Alternatively, move the select styles into the styles object.

**Step 4: Update PartContent to accept and use tokenization**

Add a `tokenized` and `encode` prop to `PartContent`:

```ts
function PartContent({ part, tokenized, encode }: { part: Part; tokenized?: boolean; encode?: (text: string) => number[] }) {
```

In the `part.text` branch, replace plain render with:

```tsx
if (part.text) {
  if (tokenized && encode) {
    return <div className={styles.messageText}><TokenizedText text={part.text} encode={encode} /></div>;
  }
  return <div className={styles.messageText}>{renderTextWithXml(part.text)}</div>;
}
```

In the `part.thinking` branch, replace plain render with:

```tsx
if (part.thinking) {
  const thinkingText = part.thinking.length > 1000 ? `${part.thinking.slice(0, 1000)}...` : part.thinking;
  if (tokenized && encode) {
    return (
      <div className={styles.messageText} style={{ fontStyle: 'italic', opacity: 0.7 }}>
        <TokenizedText text={thinkingText} encode={encode} />
      </div>
    );
  }
  return (
    <div className={styles.messageText} style={{ fontStyle: 'italic', opacity: 0.7 }}>
      {thinkingText}
    </div>
  );
}
```

**Step 5: Update MessageBlock to pass tokenization props**

```ts
function MessageBlock({ message, tokenized, encode }: { message: Message; tokenized?: boolean; encode?: (text: string) => number[] }) {
```

Pass through to PartContent:

```tsx
{message.parts.map((part, i) => (
  <PartContent key={i} part={part} tokenized={tokenized} encode={encode} />
))}
```

**Step 6: Wire up the Sections in the main render**

Update the Input section:

```tsx
<Section
  title="Input"
  count={inputTokens > 0 ? `${formatNumber(inputTokens)} tokens` : undefined}
  sectionKey="input"
  tokenized={tokenizedSections['input']}
  onToggleTokenize={() => toggleSection('input')}
  encodingOverride={encodingOverride}
  onEncodingChange={setEncodingOverride}
  tokenizerLoading={tokenizerLoading}
>
  {displayedInput.map((msg, i) => (
    <MessageBlock key={i} message={msg} tokenized={tokenizedSections['input'] && !!encode} encode={encode} />
  ))}
</Section>
```

Update the Output section similarly with `sectionKey="output"`.

Add a System Prompt section (if `gen.system_prompt` exists), placed before Input:

```tsx
{gen?.system_prompt && (
  <Section
    title="System Prompt"
    sectionKey="system"
    tokenized={tokenizedSections['system']}
    onToggleTokenize={() => toggleSection('system')}
    encodingOverride={encodingOverride}
    onEncodingChange={setEncodingOverride}
    tokenizerLoading={tokenizerLoading}
  >
    {tokenizedSections['system'] && encode ? (
      <TokenizedText text={gen.system_prompt} encode={encode} />
    ) : (
      <div className={styles.messageText}>{gen.system_prompt}</div>
    )}
  </Section>
)}
```

**Step 7: Run existing tests to verify nothing is broken**

Run: `pnpm --filter grafana-sigil-app jest -- --no-coverage`
Expected: All existing tests pass

**Step 8: Commit**

```bash
git add apps/plugin/src/components/conversation-explore/GenerationView.tsx apps/plugin/src/components/conversation-explore/GenerationView.styles.ts
git commit -m "feat(plugin): integrate tokenizer toggle into GenerationView sections"
```

---

### Task 7: Add Storybook story for TokenizedText

**Files:**
- Create: `apps/plugin/src/stories/tokenizer/TokenizedText.stories.tsx`

**Step 1: Create the story**

```tsx
// apps/plugin/src/stories/tokenizer/TokenizedText.stories.tsx
import { TokenizedText } from '../../components/tokenizer/TokenizedText';
import { useTokenizer } from '../../components/tokenizer/useTokenizer';
import type { EncodingName } from '../../components/tokenizer/encodingMap';

const meta = {
  title: 'Sigil/Tokenizer/TokenizedText',
  component: TokenizedText,
};

export default meta;

function TokenizedTextWithEncoding({ text, encoding }: { text: string; encoding: EncodingName }) {
  const { encode, isLoading } = useTokenizer(encoding);
  if (isLoading) {
    return <div>Loading tokenizer...</div>;
  }
  return <TokenizedText text={text} encode={encode} />;
}

const sampleText =
  'You are a helpful AI assistant. Please help me understand how tokenization works in large language models like GPT-4o and Claude.';

const longText =
  'The quick brown fox jumps over the lazy dog. '.repeat(20) +
  'This sentence has some unusual words like antidisestablishmentarianism and supercalifragilisticexpialidocious.';

export const WithO200kBase = {
  render: () => <TokenizedTextWithEncoding text={sampleText} encoding="o200k_base" />,
};

export const WithCl100kBase = {
  render: () => <TokenizedTextWithEncoding text={sampleText} encoding="cl100k_base" />,
};

export const LongText = {
  render: () => <TokenizedTextWithEncoding text={longText} encoding="o200k_base" />,
};

export const PlainFallback = {
  render: () => <TokenizedText text={sampleText} encode={undefined} />,
};
```

**Step 2: Verify story renders**

Run: `pnpm --filter grafana-sigil-app storybook` (manual verification in browser)
Navigate to: Sigil > Tokenizer > TokenizedText

**Step 3: Commit**

```bash
git add apps/plugin/src/stories/tokenizer/TokenizedText.stories.tsx
git commit -m "feat(plugin): add Storybook stories for TokenizedText component"
```

---

### Task 8: Run full quality checks

**Step 1: Run linting**

Run: `mise run lint`
Fix any issues.

**Step 2: Run type checking**

Run: `pnpm --filter grafana-sigil-app tsc --noEmit`
Fix any type errors.

**Step 3: Run all tests**

Run: `pnpm --filter grafana-sigil-app jest -- --no-coverage`
Expected: All tests pass.

**Step 4: Fix any issues and commit**

```bash
git add -A
git commit -m "chore(plugin): fix lint and type issues in tokenizer feature"
```
