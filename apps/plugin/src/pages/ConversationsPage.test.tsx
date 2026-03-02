import React from 'react';
import { render, screen } from '@testing-library/react';
import ConversationsPage from './ConversationsPage';

describe('ConversationsPage', () => {
  it('renders the placeholder message', () => {
    render(<ConversationsPage />);
    expect(screen.getByText('Hello from Conversations')).toBeInTheDocument();
  });
});
