import React from 'react';
import { TokenBreakdownPanel } from '../components/dashboard/TokenBreakdownPanel';
import type { PrometheusQueryResponse } from '../dashboard/types';

function makeVectorResponse(
  results: Array<{ labels: Record<string, string>; value: string }>
): PrometheusQueryResponse {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: results.map((r) => ({ metric: r.labels, value: [Date.now() / 1000, r.value] as [number, string] })),
    },
  };
}

const allTypesData = makeVectorResponse([
  { labels: { gen_ai_token_type: 'input' }, value: '482300' },
  { labels: { gen_ai_token_type: 'output' }, value: '195700' },
  { labels: { gen_ai_token_type: 'cache_read' }, value: '67400' },
  { labels: { gen_ai_token_type: 'cache_write' }, value: '12600' },
]);

const inputOutputOnly = makeVectorResponse([
  { labels: { gen_ai_token_type: 'input' }, value: '1250000' },
  { labels: { gen_ai_token_type: 'output' }, value: '340000' },
]);

const largeNumbers = makeVectorResponse([
  { labels: { gen_ai_token_type: 'input' }, value: '24500000' },
  { labels: { gen_ai_token_type: 'output' }, value: '8200000' },
  { labels: { gen_ai_token_type: 'cache_read' }, value: '3100000' },
  { labels: { gen_ai_token_type: 'cache_write' }, value: '950000' },
]);

const meta = {
  title: 'Dashboard/TokenBreakdownPanel',
  component: TokenBreakdownPanel,
};

export default meta;

export const AllTokenTypes = {
  render: () => (
    <div style={{ width: 400 }}>
      <TokenBreakdownPanel data={allTypesData} loading={false} height={320} />
    </div>
  ),
};

export const InputOutputDrilldown = {
  render: () => (
    <div style={{ width: 400 }}>
      <TokenBreakdownPanel data={inputOutputOnly} loading={false} height={320} visibleTypes={['input', 'output']} />
    </div>
  ),
};

const cacheData = makeVectorResponse([
  { labels: { gen_ai_token_type: 'cache_read' }, value: '67400' },
  { labels: { gen_ai_token_type: 'cache_write' }, value: '12600' },
]);

export const CacheDrilldown = {
  render: () => (
    <div style={{ width: 400 }}>
      <TokenBreakdownPanel data={cacheData} loading={false} height={320} visibleTypes={['cache_read', 'cache_write']} />
    </div>
  ),
};

export const LargeNumbers = {
  render: () => (
    <div style={{ width: 400 }}>
      <TokenBreakdownPanel data={largeNumbers} loading={false} height={320} />
    </div>
  ),
};

export const Loading = {
  render: () => (
    <div style={{ width: 400 }}>
      <TokenBreakdownPanel data={null} loading={true} height={320} />
    </div>
  ),
};

export const NoData = {
  render: () => (
    <div style={{ width: 400 }}>
      <TokenBreakdownPanel data={null} loading={false} height={320} />
    </div>
  ),
};
