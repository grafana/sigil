import React from 'react';
import { LandingTopBar } from '../components/landing/LandingTopBar';

const ASSISTANT_ORIGIN = 'grafana/sigil-plugin/landing';

export default function LandingPage() {
  return <LandingTopBar assistantOrigin={ASSISTANT_ORIGIN} />;
}
