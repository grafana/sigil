import { getGradientColorAtIndex } from './traceGradient';

describe('getGradientColorAtIndex', () => {
  it('returns first stop when total is one or less', () => {
    expect(getGradientColorAtIndex(0, 0)).toBe('oklab(0.87 -0.01 0.21 / 1)');
    expect(getGradientColorAtIndex(1, 0)).toBe('oklab(0.87 -0.01 0.21 / 1)');
  });

  it('returns first and last stops at the boundaries', () => {
    expect(getGradientColorAtIndex(2, 0)).toBe('oklab(0.87 -0.01 0.21 / 1)');
    expect(getGradientColorAtIndex(2, 1)).toBe('oklab(0.54 0.12 -0.28 / 1)');
  });

  it('returns a middle stop for the middle index', () => {
    expect(getGradientColorAtIndex(3, 1)).toBe('oklab(0.64 0.28 0.01 / 1)');
  });

  it('clamps out-of-range index values', () => {
    expect(getGradientColorAtIndex(4, -5)).toBe('oklab(0.87 -0.01 0.21 / 1)');
    expect(getGradientColorAtIndex(4, 99)).toBe('oklab(0.54 0.12 -0.28 / 1)');
  });

  it('applies alpha for muted colors', () => {
    expect(getGradientColorAtIndex(2, 1, 0.8)).toBe('oklab(0.54 0.12 -0.28 / 0.8)');
    expect(getGradientColorAtIndex(2, 1, 5)).toBe('oklab(0.54 0.12 -0.28 / 1)');
    expect(getGradientColorAtIndex(2, 1, -1)).toBe('oklab(0.54 0.12 -0.28 / 0)');
  });
});
