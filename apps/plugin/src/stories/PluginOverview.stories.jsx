import React from 'react';

const render = ({ title, description }) => {
  return (
    <section
      style={{
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        maxWidth: 640,
        padding: 24,
      }}
    >
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p style={{ lineHeight: 1.5, marginBottom: 0 }}>{description}</p>
    </section>
  );
};

const meta = {
  title: 'Sigil/Plugin Overview',
  render,
  args: {
    title: 'Sigil Plugin',
    description: 'Storybook is configured for the Sigil Grafana plugin workspace.',
  },
};

export default meta;

export const Default = {};
