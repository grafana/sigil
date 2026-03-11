import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabelFilterInput } from './LabelFilterInput';
import type { LabelFilter } from '../../dashboard/types';

jest.mock('@grafana/i18n', () => ({
  initPluginTranslations: jest.fn().mockResolvedValue(undefined),
  t: (_key: string, fallback: string) => fallback,
  Trans: ({ children }: { children?: React.ReactNode }) => children ?? null,
  i18n: {
    t: (_key: string, fallback: string) => fallback,
  },
}));

jest.mock('@grafana/scenes', () => {
  const React = require('react');
  const useMockVariableState = (variable: MockAdHocFiltersVariable) => {
    const [, forceRender] = React.useReducer((value: number) => value + 1, 0);

    React.useEffect(() => {
      const listener = () => forceRender();
      variable.listeners.add(listener);
      return () => {
        variable.listeners.delete(listener);
      };
    }, [variable]);

    return variable.state;
  };

  const MockCombobox = ({ model }: { model: MockAdHocFiltersVariable }) =>
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: () => model.updateFilters([{ key: 'service_name', operator: '=', value: 'sigil-api', condition: '' }]),
      },
      'Apply filter'
    );
  MockCombobox.displayName = 'MockCombobox';

  class MockAdHocFiltersVariable {
    state: { filters: Array<{ key: string; operator: string; value: string; condition: string }> };
    listeners = new Set<() => void>();
    Component: React.ComponentType<{ model: MockAdHocFiltersVariable }>;

    constructor(config: { filters: Array<{ key: string; operator: string; value: string; condition: string }> }) {
      this.state = { filters: config.filters };
      this.Component = MockCombobox;
    }

    useState() {
      // The real Scenes model exposes a hook-shaped instance method.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useMockVariableState(this);
    }

    updateFilters(filters: Array<{ key: string; operator: string; value: string; condition: string }>) {
      this.state = { filters };
      this.listeners.forEach((listener) => listener());
    }
  }

  return {
    AdHocFiltersVariable: MockAdHocFiltersVariable,
    OPERATORS: [
      { value: '=', description: 'Equals' },
      { value: '!=', description: 'Not equal' },
      { value: '=~', description: 'Matches regex' },
      { value: '!~', description: 'Does not match regex' },
    ],
  };
});

function Harness() {
  const [filters, setFilters] = useState<LabelFilter[]>([]);
  const [changeCount, setChangeCount] = useState(0);

  return (
    <>
      <LabelFilterInput
        filters={filters}
        labelKeyOptions={[{ label: 'service_name', value: 'service_name' }]}
        labelsLoading={false}
        loadValues={async () => [{ label: 'sigil-api', value: 'sigil-api' }]}
        onFiltersChange={(next) => {
          setChangeCount((count) => count + 1);
          setFilters(next);
        }}
      />
      <div data-testid="change-count">{changeCount}</div>
    </>
  );
}

describe('LabelFilterInput', () => {
  it('does not loop when the combobox updates filters and parent state follows', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply filter' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply filter' }));

    await waitFor(() => {
      expect(screen.getByTestId('change-count')).toHaveTextContent('1');
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByTestId('change-count')).toHaveTextContent('1');
  });
});
