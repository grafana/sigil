import React from 'react';
import { render, screen } from '@testing-library/react';
import { TopStat } from './TopStat';

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

describe('TopStat', () => {
  it('renders a neutral arrow when percentage change is exactly zero', () => {
    render(<TopStat label="Total Ops" value={100} prevValue={100} loading={false} prevLoading={false} />);

    const badge = screen.getByText('0.0%', { exact: false });
    expect(badge).toHaveTextContent('→ 0.0%');
  });
});
