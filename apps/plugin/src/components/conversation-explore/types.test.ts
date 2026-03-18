import { extractModelFromLabel } from './types';

describe('extractModelFromLabel', () => {
  it('extracts model from synthetic labels with " · " separator', () => {
    expect(extractModelFromLabel('travel-planner · claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
  });

  it('extracts model from span-based labels with space separator', () => {
    expect(extractModelFromLabel('chat_completion claude-3.5-sonnet')).toBe('claude-3.5-sonnet');
  });

  it('returns full label when no separator exists', () => {
    expect(extractModelFromLabel('claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
  });

  it('handles agent-only synthetic labels', () => {
    expect(extractModelFromLabel('travel-planner')).toBe('travel-planner');
  });

  it('handles model-only synthetic labels', () => {
    expect(extractModelFromLabel('gpt-4')).toBe('gpt-4');
  });

  it('handles complex model names with spaces after synthetic separator', () => {
    expect(extractModelFromLabel('my-agent · gpt-4 turbo')).toBe('gpt-4 turbo');
  });
});
