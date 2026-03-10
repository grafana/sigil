import ToolsPanel from '../components/agents/ToolsPanel';
import type { AgentTool } from '../agents/types';

const sampleTools: AgentTool[] = [
  {
    name: 'prometheus_query_handler',
    description:
      'Discover and query Prometheus time-series metrics. Metrics provide quantitative measurements (CPU, memory, request rates, errors). Essential for monitoring and performance analysis.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"datasource_uid":{"type":"string"},"query_type":{"type":"string","enum":["instant","range"]},"operation":{"type":"string"},"metric_patterns":{"type":"array","items":{"type":"string"}},"label_name":{"type":"string"},"start":{"type":"string"},"end":{"type":"string"}},"required":["datasource_uid","operation"]}',
    deferred: true,
    token_estimate: 1577,
  },
  {
    name: 'loki_query_handler',
    description: 'Query Loki for log data. Supports LogQL queries for filtering, parsing, and aggregating log streams.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"datasource_uid":{"type":"string"},"query":{"type":"string"},"start":{"type":"string"},"end":{"type":"string"},"limit":{"type":"number"}},"required":["datasource_uid","query"]}',
    deferred: true,
    token_estimate: 1577,
  },
  {
    name: 'create_dashboard',
    description: 'Create a new Grafana dashboard with panels.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"title":{"type":"string"},"panels":{"type":"array"}},"required":["title"]}',
    token_estimate: 137,
  },
  {
    name: 'alerting_manage_rules',
    description: 'Create, update, or delete alerting rules.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"action":{"type":"string","enum":["create","update","delete"]},"rule":{"type":"object"}},"required":["action"]}',
    token_estimate: 563,
  },
  {
    name: 'grafana_search',
    description: 'Search Grafana dashboards, folders, and alerts.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"query":{"type":"string"},"type":{"type":"string","enum":["dash-db","dash-folder"]}},"required":["query"]}',
    token_estimate: 134,
  },
  {
    name: 'get_entity_health',
    description: 'Get health status of monitored entities.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"entity_type":{"type":"string"},"entity_id":{"type":"string"}},"required":["entity_type","entity_id"]}',
    token_estimate: 441,
  },
  {
    name: 'search_incidents',
    description: 'Query incidents by service and severity.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"service":{"type":"string"},"severity":{"type":"string","enum":["critical","high","medium","low"]}},"required":["service"]}',
    token_estimate: 128,
  },
  {
    name: 'fetch_runbook',
    description: 'Fetch runbook markdown by key.',
    type: 'function',
    input_schema_json: '{"type":"object","properties":{"key":{"type":"string"}},"required":["key"]}',
    token_estimate: 32,
  },
];

const previousTools: AgentTool[] = [
  {
    name: 'prometheus_query_handler',
    description:
      'Discover and query Prometheus time-series metrics. Metrics provide quantitative measurements (CPU, memory, request rates). Essential for monitoring.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"datasource_uid":{"type":"string"},"query_type":{"type":"string","enum":["instant","range"]},"operation":{"type":"string"},"metric_patterns":{"type":"array","items":{"type":"string"}},"start":{"type":"string"},"end":{"type":"string"}},"required":["datasource_uid","operation"]}',
    deferred: true,
    token_estimate: 1400,
  },
  {
    name: 'loki_query_handler',
    description: 'Query Loki for log data. Supports LogQL queries for filtering, parsing, and aggregating log streams.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"datasource_uid":{"type":"string"},"query":{"type":"string"},"start":{"type":"string"},"end":{"type":"string"},"limit":{"type":"number"}},"required":["datasource_uid","query"]}',
    deferred: true,
    token_estimate: 1577,
  },
  {
    name: 'create_dashboard',
    description: 'Create a new Grafana dashboard with panels.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"title":{"type":"string"},"panels":{"type":"array"}},"required":["title"]}',
    token_estimate: 137,
  },
  {
    name: 'alerting_manage_rules',
    description: 'Create, update, or delete alerting rules.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"action":{"type":"string","enum":["create","update","delete"]},"rule":{"type":"object"}},"required":["action"]}',
    token_estimate: 563,
  },
  {
    name: 'grafana_search',
    description: 'Search Grafana dashboards and folders.',
    type: 'function',
    input_schema_json: '{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}',
    token_estimate: 98,
  },
  {
    name: 'get_entity_health',
    description: 'Get health status of monitored entities.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"entity_type":{"type":"string"},"entity_id":{"type":"string"}},"required":["entity_type","entity_id"]}',
    token_estimate: 441,
  },
  {
    name: 'search_incidents',
    description: 'Query incidents by service and severity.',
    type: 'function',
    input_schema_json:
      '{"type":"object","properties":{"service":{"type":"string"},"severity":{"type":"string","enum":["critical","high","medium","low"]}},"required":["service"]}',
    token_estimate: 128,
  },
];

const meta = {
  title: 'Sigil/Agents/Tools Panel',
  component: ToolsPanel,
  args: {
    tools: sampleTools,
  },
};

export default meta;

export const Default = {};

export const FewTools = {
  args: {
    tools: sampleTools.slice(0, 3),
  },
};

export const Empty = {
  args: {
    tools: [],
  },
};

export const WithDiff = {
  args: {
    tools: sampleTools,
    previousTools,
  },
};
