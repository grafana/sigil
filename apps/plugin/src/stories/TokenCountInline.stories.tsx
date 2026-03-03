import TokenCountInline from '../components/conversations/TokenCountInline';

const meta = {
  title: 'Sigil/Conversations/TokenCountInline',
  component: TokenCountInline,
};

export default meta;

export const Default = {
  args: {
    inputTokens: 256,
    outputTokens: 512,
    totalTokens: 768,
  },
};

export const MixedTypes = {
  args: {
    inputTokens: '1024',
    outputTokens: 385,
    totalTokens: '1409',
  },
};

export const MissingValues = {
  args: {
    inputTokens: undefined,
    outputTokens: '',
    totalTokens: null,
  },
};
