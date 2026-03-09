import { HighlightedJson } from '../../components/conversation-explore/HighlightedJson';

const meta = {
  title: 'Sigil/Conversation Explore/HighlightedJson',
  component: HighlightedJson,
};

export default meta;

const shortJson = JSON.stringify(
  {
    location: 'Costa Rica',
    dates: '2024-06-10/2024-06-15',
    forecast: { temp: '28-32°C', conditions: 'Warm and humid' },
  },
  null,
  2
);

const toolResultJson = JSON.stringify(
  {
    results: [
      {
        signal: 'logs',
        totalRecommendations: 98,
        totalPotentialVolumeSavings: '290.8 GB/day',
        showing: 'top 10 by volume savings',
        recommendations: [
          {
            pattern: 'level=info ts=<TIMESTAMP> caller=mirror.go:<NUM> msg="request forwarded"',
            levels: ['info'],
            dropRate: '50% → 99%',
            volumeSavings: '50.1 GB/day',
          },
          {
            pattern: 'ts=<TIMESTAMP> caller=log.go:<NUM> level=info trace_id_unsampled=<HEX>',
            levels: ['info'],
            dropRate: '0% → 99%',
            volumeSavings: '48.3 GB/day',
          },
          {
            pattern: 'ts=<TIMESTAMP> caller=http.go:<NUM> level=debug traceID=<HEX> method=POST',
            levels: ['debug'],
            dropRate: '50% → 99%',
            volumeSavings: '47.2 GB/day',
          },
          {
            pattern: 'ts=<TIMESTAMP> caller=distributor.go:<NUM> component=distributor tenant=<NUM>',
            levels: ['debug'],
            dropRate: '0% → 99%',
            volumeSavings: '32.6 GB/day',
          },
          {
            pattern: 'ts=<TIMESTAMP> caller=multitenant.go:<NUM> level=debug component=MultiTenantAlertmanager',
            levels: ['debug'],
            dropRate: '0% → 99%',
            volumeSavings: '20.5 GB/day',
          },
        ],
      },
    ],
  },
  null,
  2
);

const mixedTypesJson = JSON.stringify(
  {
    name: 'test-agent',
    version: 3,
    enabled: true,
    metadata: null,
    tags: ['production', 'v2'],
    config: {
      maxRetries: 5,
      timeout: 30.5,
      debug: false,
      endpoints: ['https://api.example.com', 'https://backup.example.com'],
    },
  },
  null,
  2
);

export const Short = {
  args: { content: shortJson },
};

export const ToolResult = {
  args: { content: toolResultJson },
};

export const MixedTypes = {
  args: { content: mixedTypesJson },
};

export const Collapsed = {
  args: { content: toolResultJson, maxCollapsedLines: 10 },
};

export const PlainText = {
  args: { content: 'This is not JSON, just plain text output from a tool.' },
};

export const Screenshot = ToolResult;
