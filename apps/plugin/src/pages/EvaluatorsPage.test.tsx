import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { EvaluationDataSource } from '../evaluation/api';
import type { TemplateDefinition } from '../evaluation/types';
import EvaluatorsPage from './EvaluatorsPage';

jest.mock('../components/insight/PageInsightBar', () => ({
  PageInsightBar: () => null,
}));

beforeAll(() => {
  if (typeof globalThis.Request === 'undefined') {
    class RequestMock {
      method: string;

      constructor(_input: unknown, init?: { method?: string }) {
        this.method = String(init?.method ?? 'GET').toUpperCase();
      }
    }

    Object.defineProperty(globalThis, 'Request', {
      writable: true,
      configurable: true,
      value: RequestMock,
    });
  }
});

function createTemplate(scope: 'global' | 'tenant', index: number): TemplateDefinition {
  return {
    tenant_id: scope === 'tenant' ? 'tenant-1' : '',
    template_id: `${scope}.template.${String(index).padStart(2, '0')}`,
    scope,
    kind: 'llm_judge',
    description: `${scope} template ${index}`,
    latest_version: '1',
    output_keys: [{ key: 'score', type: 'number' }],
    versions: [],
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  };
}

describe('EvaluatorsPage', () => {
  it('resets to first template page when scope filter changes', async () => {
    const allTemplates = [
      ...Array.from({ length: 20 }, (_, idx) => createTemplate('global', idx + 1)),
      ...Array.from({ length: 20 }, (_, idx) => createTemplate('tenant', idx + 1)),
    ];
    const tenantTemplates = allTemplates.filter((template) => template.scope === 'tenant');
    const globalTemplates = allTemplates.filter((template) => template.scope === 'global');

    const dataSource = {
      listEvaluators: jest.fn(async () => ({
        items: [
          {
            evaluator_id: 'tenant.eval.1',
            version: '1',
            kind: 'llm_judge',
            description: '',
            config: {},
            output_keys: [{ key: 'score', type: 'number' }],
            is_predefined: false,
            created_at: '2026-03-01T00:00:00Z',
            updated_at: '2026-03-01T00:00:00Z',
          },
        ],
        next_cursor: '',
      })),
      listTemplates: jest.fn(async (scope?: 'global' | 'tenant') => ({
        items: scope === 'tenant' ? tenantTemplates : scope === 'global' ? globalTemplates : allTemplates,
        next_cursor: '',
      })),
    } as unknown as EvaluationDataSource;

    const router = createMemoryRouter(
      [
        {
          path: '/a/grafana-sigil-app/evaluation',
          element: <EvaluatorsPage dataSource={dataSource} />,
        },
      ],
      {
        initialEntries: ['/a/grafana-sigil-app/evaluation'],
      }
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Showing 1-15 of 40')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[1]);
    await screen.findByText('Showing 16-30 of 40');
    fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[1]);
    await screen.findByText('Showing 31-40 of 40');

    fireEvent.mouseDown(screen.getByText('All scopes'));
    fireEvent.click(await screen.findByText('Tenant'));

    await waitFor(() => {
      expect(screen.getByText('Showing 1-15 of 20')).toBeInTheDocument();
    });
  });
});
