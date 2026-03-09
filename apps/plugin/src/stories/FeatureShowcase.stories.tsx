import React from 'react';
import { FeatureShowcase } from '../components/landing/FeatureShowcase';

export default {
  title: 'Landing/FeatureShowcase',
  component: FeatureShowcase,
};

export const Default = {
  render: () => (
    <div style={{ maxWidth: 440 }}>
      <FeatureShowcase />
    </div>
  ),
};
