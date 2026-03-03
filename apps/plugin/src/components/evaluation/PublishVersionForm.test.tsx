import React from 'react';
import { render, screen } from '@testing-library/react';
import PublishVersionForm from './PublishVersionForm';

describe('PublishVersionForm', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-03T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('suggests the first free suffixed version after .100', () => {
    const existingVersions = ['2026-03-03', ...Array.from({ length: 100 }, (_, i) => `2026-03-03.${i + 1}`)];

    render(<PublishVersionForm existingVersions={existingVersions} onSubmit={jest.fn()} onCancel={jest.fn()} />);

    expect(screen.getByPlaceholderText('2026-03-03')).toHaveValue('2026-03-03.101');
  });
});
