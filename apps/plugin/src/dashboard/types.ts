// Prometheus API response types

export type PrometheusMatrixResult = {
  metric: Record<string, string>;
  values: Array<[number, string]>;
};

export type PrometheusVectorResult = {
  metric: Record<string, string>;
  value: [number, string];
};

export type PrometheusQueryResponse = {
  status: 'success' | 'error';
  data: {
    resultType: 'matrix' | 'vector' | 'scalar' | 'string';
    result: PrometheusMatrixResult[] | PrometheusVectorResult[];
  };
  error?: string;
  errorType?: string;
};

export type PrometheusLabelValuesResponse = {
  status: 'success' | 'error';
  data: string[];
};

export type PrometheusLabelsResponse = {
  status: 'success' | 'error';
  data: string[];
};

// Model card types (matching Sigil API contract from modelcards/types.go)

export type ModelCardPricing = {
  prompt_usd_per_token: number | null;
  completion_usd_per_token: number | null;
  request_usd: number | null;
  image_usd: number | null;
  web_search_usd: number | null;
  input_cache_read_usd_per_token: number | null;
  input_cache_write_usd_per_token: number | null;
};

export type ModelCard = {
  model_key: string;
  source: string;
  source_model_id: string;
  canonical_slug: string;
  name: string;
  provider: string;
  pricing: ModelCardPricing;
  is_free: boolean;
};

export type ModelCardFreshness = {
  catalog_last_refreshed_at: string | null;
  stale: boolean;
  soft_stale: boolean;
  hard_stale: boolean;
  source_path: string;
};

export type ModelCardListResponse = {
  data: ModelCard[];
  next_cursor: string;
  freshness: ModelCardFreshness;
};

export type ModelResolvePair = {
  provider: string;
  model: string;
};

export type ResolvedModelCard = {
  model_key: string;
  source_model_id: string;
  pricing: ModelCardPricing;
};

export type ModelCardResolveItem = {
  provider: string;
  model: string;
  status: 'resolved' | 'unresolved';
  match_strategy?: 'exact' | 'normalized';
  reason?: 'not_found' | 'ambiguous' | 'invalid_input';
  card?: ResolvedModelCard;
};

export type ModelCardResolveResponse = {
  resolved: ModelCardResolveItem[];
  freshness: ModelCardFreshness;
};

// Dashboard tab
export type DashboardTab = 'overview' | 'performance' | 'errors' | 'usage';

// Dashboard filter state

export type FilterOperator = '=' | '!=' | '=~' | '!~' | '<' | '>' | '<=' | '>=';

export const FILTER_OPERATORS: FilterOperator[] = ['=', '!=', '=~', '!~', '<', '>', '<=', '>='];

export const filterOperatorLabel: Record<FilterOperator, string> = {
  '=': 'Equals',
  '!=': 'Not equal',
  '=~': 'Matches regex',
  '!~': 'Does not match regex',
  '<': 'Less than',
  '>': 'Greater than',
  '<=': 'Less than or equal',
  '>=': 'Greater than or equal',
};

export type LabelFilter = {
  key: string;
  operator: FilterOperator;
  value: string;
};

export type DashboardFilters = {
  providers: string[];
  models: string[];
  agentNames: string[];
  labelFilters: LabelFilter[];
};

export const emptyFilters: DashboardFilters = {
  providers: [],
  models: [],
  agentNames: [],
  labelFilters: [],
};

// Breakdown dimension for timeseries group-by

export type BreakdownDimension = 'none' | 'provider' | 'model' | 'agent';

// Latency percentile selector

export type LatencyPercentile = 'p50' | 'p95' | 'p99';

// Cost display mode

export type CostMode = 'usd' | 'tokens';

// Token drilldown: which token types to show in the cost panels

export type TokenDrilldown = 'all' | 'io' | 'cache';

export const tokenDrilldownTypes: Record<TokenDrilldown, string[] | undefined> = {
  all: undefined,
  io: ['input', 'output'],
  cache: ['cache_read', 'cache_write'],
};

export const breakdownLabel: Record<BreakdownDimension, string> = {
  none: 'None',
  provider: 'Provider',
  model: 'Model',
  agent: 'Agent',
};

export const breakdownToPromLabel: Record<BreakdownDimension, string> = {
  none: '',
  provider: 'gen_ai_provider_name',
  model: 'gen_ai_request_model',
  agent: 'gen_ai_agent_name',
};
