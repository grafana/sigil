import React from 'react';
import { TopStat, type TopStatProps } from '../components/TopStat';

export default {
  title: 'Components/TopStat',
  component: TopStat,
};

const Template = (args: TopStatProps) => (
  <div style={{ padding: 16 }}>
    <TopStat {...args} />
  </div>
);

export const Default = () => <Template label="Total Requests" value={12345} loading={false} />;

export const Loading = () => <Template label="Total Requests" value={0} loading />;

export const WithIncrease = () => (
  <Template label="Total Requests" value={150} loading={false} prevValue={100} prevLoading={false} />
);

export const WithDecrease = () => (
  <Template label="Total Requests" value={80} loading={false} prevValue={100} prevLoading={false} />
);

export const WithInvertedIncrease = () => (
  <Template
    label="Error Rate"
    value={5.2}
    unit="percent"
    loading={false}
    prevValue={3.1}
    prevLoading={false}
    invertChange
  />
);

export const WithInvertedDecrease = () => (
  <Template
    label="Avg Latency (P95)"
    value={0.8}
    unit="s"
    loading={false}
    prevValue={1.2}
    prevLoading={false}
    invertChange
  />
);

export const NeutralChange = () => (
  <Template label="Total Tokens" value={5000} unit="short" loading={false} prevValue={5000} prevLoading={false} />
);

export const NewValue = () => (
  <Template label="Total Requests" value={42} loading={false} prevValue={0} prevLoading={false} />
);

export const CustomComparisonLabel = () => (
  <Template
    label="Conversations"
    value={230}
    loading={false}
    prevValue={180}
    prevLoading={false}
    comparisonLabel="in previous window"
  />
);

export const StatsRow = () => (
  <div style={{ display: 'flex', gap: 32, padding: 16 }}>
    <TopStat label="Total Requests" value={12345} loading={false} prevValue={11000} prevLoading={false} />
    <TopStat
      label="Avg Latency (P95)"
      value={0.45}
      unit="s"
      loading={false}
      prevValue={0.52}
      prevLoading={false}
      invertChange
    />
    <TopStat
      label="Error Rate"
      value={2.3}
      unit="percent"
      loading={false}
      prevValue={1.8}
      prevLoading={false}
      invertChange
    />
    <TopStat label="Total Tokens" value={89000} unit="short" loading={false} prevValue={75000} prevLoading={false} />
    <TopStat
      label="Total Cost"
      value={12.5}
      unit="currencyUSD"
      loading={false}
      prevValue={14.2}
      prevLoading={false}
      invertChange
    />
  </div>
);
