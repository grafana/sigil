import React, { useState } from 'react';
import ModelCardPopover from '../components/conversations/ModelCardPopover';
import type { ModelCard } from '../modelcard/types';

const gpt4o: ModelCard = {
  model_key: 'openrouter:openai/gpt-4o',
  source: 'openrouter',
  source_model_id: 'openai/gpt-4o',
  canonical_slug: 'openai/gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  description:
    "GPT-4o is OpenAI's most advanced multimodal model, combining text and image understanding with fast response times.",
  context_length: 128000,
  modality: 'text+image->text',
  input_modalities: ['text', 'image'],
  output_modalities: ['text'],
  tokenizer: 'o200k_base',
  pricing: {
    prompt_usd_per_token: 0.0000025,
    completion_usd_per_token: 0.00001,
    request_usd: null,
    image_usd: null,
    web_search_usd: null,
    input_cache_read_usd_per_token: 0.00000125,
    input_cache_write_usd_per_token: 0.00000315,
  },
  is_free: false,
  top_provider: {
    context_length: 128000,
    max_completion_tokens: 16384,
  },
  first_seen_at: '2024-05-13T00:00:00Z',
  last_seen_at: '2026-03-03T00:00:00Z',
  refreshed_at: '2026-03-03T00:00:00Z',
};

const claude: ModelCard = {
  model_key: 'openrouter:anthropic/claude-sonnet-4-20250514',
  source: 'openrouter',
  source_model_id: 'anthropic/claude-sonnet-4-20250514',
  canonical_slug: 'anthropic/claude-sonnet-4',
  name: 'Claude Sonnet 4',
  provider: 'anthropic',
  description: "Claude Sonnet 4 is Anthropic's balanced model offering strong reasoning with efficient cost.",
  context_length: 200000,
  modality: 'text+image->text',
  input_modalities: ['text', 'image'],
  output_modalities: ['text'],
  tokenizer: 'claude',
  pricing: {
    prompt_usd_per_token: 0.000003,
    completion_usd_per_token: 0.000015,
    request_usd: null,
    image_usd: null,
    web_search_usd: null,
    input_cache_read_usd_per_token: 0.0000003,
    input_cache_write_usd_per_token: 0.00000375,
  },
  is_free: false,
  top_provider: {
    context_length: 200000,
    max_completion_tokens: 64000,
  },
  first_seen_at: '2025-05-14T00:00:00Z',
  last_seen_at: '2026-03-03T00:00:00Z',
  refreshed_at: '2026-03-03T00:00:00Z',
};

const freeModel: ModelCard = {
  model_key: 'openrouter:meta-llama/llama-3.1-8b-instruct:free',
  source: 'openrouter',
  source_model_id: 'meta-llama/llama-3.1-8b-instruct:free',
  canonical_slug: 'meta-llama/llama-3.1-8b-instruct',
  name: 'Llama 3.1 8B Instruct (Free)',
  provider: 'meta',
  description: "Meta's Llama 3.1 8B instruction-tuned model, available for free on OpenRouter.",
  context_length: 131072,
  modality: 'text->text',
  input_modalities: ['text'],
  output_modalities: ['text'],
  pricing: {
    prompt_usd_per_token: 0,
    completion_usd_per_token: 0,
    request_usd: null,
    image_usd: null,
    web_search_usd: null,
    input_cache_read_usd_per_token: null,
    input_cache_write_usd_per_token: null,
  },
  is_free: true,
  top_provider: {
    context_length: 131072,
    max_completion_tokens: 8192,
  },
  first_seen_at: '2024-07-23T00:00:00Z',
  last_seen_at: '2026-03-03T00:00:00Z',
  refreshed_at: '2026-03-03T00:00:00Z',
};

function PopoverWrapper({ card }: { card: ModelCard }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        style={{ padding: '8px 16px' }}
      >
        Show card for {card.name}
      </button>
    );
  }
  return (
    <div style={{ position: 'relative', display: 'inline-block', margin: 40 }}>
      <ModelCardPopover
        card={card}
        onClose={() => {
          setOpen(false);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Sigil/Model Card Popover',
  component: ModelCardPopover,
};

export default meta;

export const OpenAI = () => <PopoverWrapper card={gpt4o} />;
export const Anthropic = () => <PopoverWrapper card={claude} />;
export const FreeModel = () => <PopoverWrapper card={freeModel} />;
