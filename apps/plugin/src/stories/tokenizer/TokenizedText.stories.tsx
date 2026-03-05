import React from 'react';
import { TokenizedText } from '../../components/tokenizer/TokenizedText';
import { useTokenizer } from '../../components/tokenizer/useTokenizer';
import type { EncodingName } from '../../components/tokenizer/encodingMap';

const meta = {
  title: 'Sigil/Tokenizer/TokenizedText',
  component: TokenizedText,
};

export default meta;

function TokenizedTextWithEncoding({ text, encoding }: { text: string; encoding: EncodingName }) {
  const { encode, decode, isLoading } = useTokenizer(encoding);
  if (isLoading) {
    return <div>Loading tokenizer...</div>;
  }
  return <TokenizedText text={text} encode={encode} decode={decode} />;
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
  render: () => <TokenizedText text={sampleText} encode={undefined} decode={undefined} />,
};
