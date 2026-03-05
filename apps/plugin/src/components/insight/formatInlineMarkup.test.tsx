import React from 'react';
import { render } from '@testing-library/react';
import { formatInlineMarkup } from './formatInlineMarkup';

describe('formatInlineMarkup', () => {
  it('returns plain text unchanged', () => {
    const result = formatInlineMarkup('hello world');
    expect(result).toEqual(['hello world']);
  });

  it('wraps **bold** in <strong>', () => {
    const { container } = render(<span>{formatInlineMarkup('use **bold** text')}</span>);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('bold');
  });

  it('wraps `code` in <code>', () => {
    const { container } = render(<span>{formatInlineMarkup('run `npm install`')}</span>);
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe('npm install');
  });

  it('handles mixed bold and code', () => {
    const { container } = render(<span>{formatInlineMarkup('**Error rate** spiked in `us-east-1`')}</span>);
    expect(container.querySelector('strong')?.textContent).toBe('Error rate');
    expect(container.querySelector('code')?.textContent).toBe('us-east-1');
  });

  it('handles empty string', () => {
    const result = formatInlineMarkup('');
    expect(result).toHaveLength(0);
  });
});
