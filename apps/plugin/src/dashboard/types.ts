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

// Dashboard filter state

export type DashboardFilters = {
  provider: string;
  model: string;
  agentName: string;
  labelKey: string;
  labelValue: string;
  extraMatchers: string;
};

export const emptyFilters: DashboardFilters = {
  provider: '',
  model: '',
  agentName: '',
  labelKey: '',
  labelValue: '',
  extraMatchers: '',
};
