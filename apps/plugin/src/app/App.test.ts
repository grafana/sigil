import { isChromeLightRoute } from './App';

describe('isChromeLightRoute', () => {
  it('uses chrome-light layout for list and focused pages only', () => {
    expect(isChromeLightRoute('conversations')).toBe(true);
    expect(isChromeLightRoute('conversations/conv-1/view')).toBe(true);
    expect(isChromeLightRoute('conversations/conv-1/explore')).toBe(true);
    expect(isChromeLightRoute('agents')).toBe(true);
    expect(isChromeLightRoute('tutorial')).toBe(true);
    expect(isChromeLightRoute('tutorial/what-is-sigil')).toBe(true);
    expect(isChromeLightRoute('evaluation')).toBe(true);
    expect(isChromeLightRoute('evaluation/runs')).toBe(true);
  });

  it('keeps detail pages on padded layout', () => {
    expect(isChromeLightRoute('conversations/conv-1/detail')).toBe(false);
    expect(isChromeLightRoute('agents/name/some-agent')).toBe(false);
    expect(isChromeLightRoute('agents/anonymous')).toBe(false);
  });
});
