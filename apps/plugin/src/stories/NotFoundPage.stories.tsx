import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import NotFoundPage from '../pages/NotFoundPage';

const meta = {
  title: 'Sigil/NotFound Page',
  component: NotFoundPage,
  render: () => (
    <MemoryRouter>
      <NotFoundPage />
    </MemoryRouter>
  ),
};

export default meta;
export const Default = {};
