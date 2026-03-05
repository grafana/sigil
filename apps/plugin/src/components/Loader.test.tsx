import React from 'react';
import { act, render } from '@testing-library/react';
import { Loader } from './Loader';

describe('Loader', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('resets typing state when lines prop changes', () => {
    const { container, rerender } = render(<Loader showText lines={['A', 'B']} />);
    const row = container.querySelector('[aria-live="polite"]');

    for (let step = 0; step < 120 && !(row?.textContent ?? '').includes('B'); step++) {
      act(() => {
        jest.advanceTimersByTime(50);
      });
    }

    expect(row?.textContent).toContain('B');

    rerender(<Loader showText lines={['Z']} />);

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(row?.textContent).toContain('Z');
  });
});
