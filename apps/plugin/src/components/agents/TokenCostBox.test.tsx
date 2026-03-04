import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TokenCostBox from './TokenCostBox';

describe('TokenCostBox', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to token display when nothing is stored', () => {
    render(<TokenCostBox tokenCount={1234} costUSD={0.1234} />);

    const select = screen.getByRole('combobox', { name: 'Token cost display mode' });
    expect(select).toHaveValue('tokens');
    expect(select).toHaveTextContent('1,234 tokens');
  });

  it('restores usd mode from localStorage', () => {
    window.localStorage.setItem('sigil.tokenCostBox.mode', 'usd');

    render(<TokenCostBox tokenCount={1234} costUSD={0.1234} />);

    const select = screen.getByRole('combobox', { name: 'Token cost display mode' });
    expect(select).toHaveValue('usd');
    expect(select).toHaveTextContent('$0.1234');
  });

  it('persists selected mode', () => {
    render(<TokenCostBox tokenCount={500} costUSD={0.02} />);

    const select = screen.getByRole('combobox', { name: 'Token cost display mode' });
    fireEvent.change(select, { target: { value: 'usd' } });

    expect(window.localStorage.getItem('sigil.tokenCostBox.mode')).toBe('usd');
  });

  it('syncs mode across all TokenCostBox instances', () => {
    render(
      <>
        <TokenCostBox tokenCount={500} costUSD={0.02} ariaLabel="mode one" />
        <TokenCostBox tokenCount={600} costUSD={0.03} ariaLabel="mode two" />
      </>
    );

    const first = screen.getByRole('combobox', { name: 'mode one' });
    const second = screen.getByRole('combobox', { name: 'mode two' });
    expect(first).toHaveValue('tokens');
    expect(second).toHaveValue('tokens');

    fireEvent.change(first, { target: { value: 'usd' } });

    expect(first).toHaveValue('usd');
    expect(second).toHaveValue('usd');
  });
});
