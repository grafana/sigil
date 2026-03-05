import React from 'react';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import TutorialPage from './TutorialPage';
import { PLUGIN_BASE, ROUTES } from '../constants';

describe('TutorialPage', () => {
  it('renders telemetry field details in the signal mosaic', async () => {
    const router = createMemoryRouter(
      [
        {
          path: `${PLUGIN_BASE}/${ROUTES.Tutorial}/*`,
          element: <TutorialPage />,
        },
      ],
      {
        initialEntries: [`${PLUGIN_BASE}/${ROUTES.Tutorial}/about-the-telemetry-signal`],
      }
    );

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByText('Top-level correlation key across app logs, traces, and Sigil.')
    ).toBeInTheDocument();
  });
});
