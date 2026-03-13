import type { AppPlugin, KeyValue } from '@grafana/data';
import { providePageContext, createAssistantContextItem, type ChatContextItem } from '@grafana/assistant';
import { sigilProjectContext } from '../content/sigilProjectContext';

type SigilJSONData = {
  prometheusDatasourceUID?: string;
  tempoDatasourceUID?: string;
};

export async function bootstrap<T extends KeyValue>(plugin: AppPlugin<T>): Promise<void> {
  const jsonData = plugin.meta.jsonData as (SigilJSONData & T) | undefined;
  const promUID = jsonData?.prometheusDatasourceUID?.trim() ?? '';
  const tempoUID = jsonData?.tempoDatasourceUID?.trim() ?? '';

  const contextItems: ChatContextItem[] = [
    createAssistantContextItem('structured', {
      hidden: true,
      title: 'Sigil knowledgebase',
      data: {
        name: 'Sigil knowledgebase',
        text: sigilProjectContext,
      },
    }),
  ];

  if (promUID) {
    contextItems.push(createAssistantContextItem('datasource', { datasourceUid: promUID, title: 'Sigil Prometheus' }));
  }
  if (tempoUID) {
    contextItems.push(createAssistantContextItem('datasource', { datasourceUid: tempoUID, title: 'Sigil Tempo' }));
  }

  contextItems.push(
    createAssistantContextItem('structured', {
      hidden: true,
      title: 'Sigil metrics & tracing reference',
      data: {
        description:
          'OTel-based metrics and traces available for Sigil AI observability. Use this when the user asks about metrics, trends, or wants to build queries.',
        datasources: {
          prometheus_uid: promUID || null,
          tempo_uid: tempoUID || null,
        },
        otel_metrics: {
          gen_ai_client_token_usage: {
            type: 'counter',
            unit: 'tokens',
            description: 'Token consumption by LLM calls.',
            key_labels: ['gen_ai_provider_name', 'gen_ai_request_model', 'gen_ai_agent_name', 'gen_ai_token_type'],
            token_types: ['input', 'output', 'cache_read', 'cache_write'],
            example_queries: [
              'sum by (gen_ai_request_model, gen_ai_token_type) (increase(gen_ai_client_token_usage_sum[1h]))',
              'sum(rate(gen_ai_client_token_usage_sum{gen_ai_token_type="input"}[5m]))',
            ],
          },
          gen_ai_client_operation_duration_seconds: {
            type: 'histogram',
            unit: 'seconds',
            description: 'Latency of LLM generation calls. Use _bucket for percentiles, _count for throughput.',
            key_labels: ['gen_ai_provider_name', 'gen_ai_request_model', 'gen_ai_tool_name', 'gen_ai_agent_name', 'error_type'],
            example_queries: [
              'histogram_quantile(0.95, sum by (le) (rate(gen_ai_client_operation_duration_seconds_bucket[5m])))',
              'sum(rate(gen_ai_client_operation_duration_seconds_count[5m]))',
              'sum(rate(gen_ai_client_operation_duration_seconds_count{error_type!=""}[5m]))',
            ],
          },
          gen_ai_client_time_to_first_token_seconds: {
            type: 'histogram',
            unit: 'seconds',
            description: 'Time-to-first-token for streaming LLM calls.',
            key_labels: ['gen_ai_provider_name', 'gen_ai_request_model', 'gen_ai_agent_name'],
            example_queries: [
              'histogram_quantile(0.95, sum by (le) (rate(gen_ai_client_time_to_first_token_seconds_bucket[5m])))',
            ],
          },
        },
        common_label_names: {
          gen_ai_provider_name: 'LLM provider (e.g. openai, anthropic)',
          gen_ai_request_model: 'Model name (e.g. gpt-4o, claude-sonnet-4-20250514)',
          gen_ai_tool_name: 'Tool name for execute_tool runtime metrics (e.g. weather, web_search)',
          gen_ai_agent_name: 'Agent or component name in the application',
          gen_ai_token_type: 'Token category: input, output, cache_read, cache_write',
          error_type: 'Error classification (empty string means success)',
        },
        guidance: [
          'When the user asks about metrics trends, build PromQL queries using the metrics and labels above.',
          'For latency analysis, use histogram_quantile on _bucket with appropriate percentiles (p50, p95, p99).',
          'For cost estimation, query token_usage by model and token_type, then apply model pricing.',
          'For error analysis, filter on error_type!="" in operation_duration_seconds.',
          'Cache hit rate = cache_read / (cache_read + input) tokens.',
          'When referencing traces, the user can look up specific trace IDs in Tempo via the Grafana Explore view.',
        ],
      },
    })
  );

  providePageContext(/\/a\/grafana-sigil-app\/.+/, contextItems);
}
