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
    const { container, rerender } = render(<Loader showText lines={['ABCD', 'EFGH']} />);
    const row = container.querySelector('[aria-live="polite"]');

    for (let step = 0; step < 200 && !(row?.textContent ?? '').includes('EF'); step++) {
      act(() => {
        jest.advanceTimersByTime(50);
      });
    }

    expect(row?.textContent).toContain('EF');

    rerender(<Loader showText lines={['WXYZ', 'QRST']} />);
    const nextRow = container.querySelector('[aria-live="polite"]');

    // On prop change we should restart from the first new line.
    expect(nextRow?.textContent).toContain('|');
    expect(nextRow?.textContent).not.toContain('Q');

    act(() => {
      jest.advanceTimersByTime(50);
    });

    expect(nextRow?.textContent).toContain('W');
    expect(nextRow?.textContent).not.toContain('Q');
  });
});
