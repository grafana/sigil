export type ModelCardPricing = {
  prompt_usd_per_token: number | null;
  completion_usd_per_token: number | null;
  request_usd: number | null;
  image_usd: number | null;
  web_search_usd: number | null;
  input_cache_read_usd_per_token: number | null;
  input_cache_write_usd_per_token: number | null;
};

export type ModelCardTopProvider = {
  context_length?: number | null;
  max_completion_tokens?: number | null;
  is_moderated?: boolean | null;
};

export type ModelCard = {
  model_key: string;
  source: string;
  source_model_id: string;
  canonical_slug: string;
  name: string;
  provider: string;
  description?: string;
  context_length?: number | null;
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_parameters?: string[];
  tokenizer?: string;
  pricing: ModelCardPricing;
  is_free: boolean;
  top_provider: ModelCardTopProvider;
  expires_at?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  refreshed_at: string;
};

export type ModelCardFreshness = {
  catalog_last_refreshed_at: string | null;
  stale: boolean;
  soft_stale: boolean;
  hard_stale: boolean;
  source_path: string;
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

export type ModelCardLookupResponse = {
  data: ModelCard;
  freshness: ModelCardFreshness;
};
