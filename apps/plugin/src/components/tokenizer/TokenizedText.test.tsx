import React from 'react';
import { render } from '@testing-library/react';
import { TokenizedText } from './TokenizedText';

describe('TokenizedText', () => {
  it('renders colored spans when encode/decode are provided', () => {
    const encode = (text: string) => [100, 200, 300];
    const decode = (ids: number[]) => (ids[0] === 100 ? 'Hello' : ids[0] === 200 ? ' ' : 'world');

    const { container } = render(<TokenizedText text="Hello world" encode={encode} decode={decode} />);

    const spans = container.querySelectorAll('[data-token-id]');
    expect(spans.length).toBe(3);
    expect(spans[0].textContent).toBe('Hello');
    expect(spans[0].getAttribute('data-token-id')).toBe('100');
  });

  it('renders plain text when encode is undefined', () => {
    const { container } = render(<TokenizedText text="Hello world" encode={undefined} decode={undefined} />);

    expect(container.textContent).toBe('Hello world');
    expect(container.querySelectorAll('[data-token-id]').length).toBe(0);
  });
});
