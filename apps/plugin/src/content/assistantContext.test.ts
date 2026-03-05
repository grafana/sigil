import {
  buildSigilAssistantContextItems,
  buildSigilAssistantPrompt,
  withSigilProjectContextFallback,
} from './assistantContext';

describe('assistantContext', () => {
  it('keeps assistant prompt user-only for openAssistant', () => {
    const result = buildSigilAssistantPrompt('  What is Sigil?  ');
    expect(result).toBe('What is Sigil?');
  });

  it('builds structured Sigil context items for openAssistant context', () => {
    const contextItems = buildSigilAssistantContextItems();
    expect(contextItems).toHaveLength(1);
    expect(contextItems[0].node.name).toBe('Sigil knowledgebase');
  });

  it('builds fallback prompt with context and user request', () => {
    const result = withSigilProjectContextFallback('What fields are in the spec?');

    expect(result).toContain('Sigil knowledgebase (ground truth)');
    expect(result).toContain('User request:\nWhat fields are in the spec?');
  });

  it('returns empty string for empty or whitespace fallback prompt', () => {
    expect(withSigilProjectContextFallback('')).toBe('');
    expect(withSigilProjectContextFallback('   ')).toBe('');
  });
});
