import type { GenerationDetail } from '../../conversation/types';
import { buildPricingMap } from '../../dashboard/cost';
import {
  buildGenerationMetrics,
  formatLatency,
  resolveGenerationCostUsd,
  resolveGenerationLatencyMs,
  resolveGenerationTokenCount,
} from './generationMetrics';

describe('generationMetrics', () => {
  const pricingMap = buildPricingMap([
    {
      provider: 'openai',
      model: 'gpt-4o-mini',
      pricing: {
        prompt_usd_per_token: 0.0025,
        completion_usd_per_token: 0.01,
        request_usd: null,
        image_usd: null,
        web_search_usd: null,
        input_cache_read_usd_per_token: 0.001,
        input_cache_write_usd_per_token: 0.003,
      },
    },
  ]);

  it('uses total_tokens as the primary token count', () => {
    const generation = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      usage: { input_tokens: '10', output_tokens: '20', total_tokens: '40' },
    } as GenerationDetail;

    expect(resolveGenerationTokenCount(generation)).toBe(40);
  });

  it('falls back to input + output when total_tokens is unavailable', () => {
    const generation = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      usage: { input_tokens: '10', output_tokens: '20' },
    } as GenerationDetail;

    expect(resolveGenerationTokenCount(generation)).toBe(30);
  });

  it('computes latency from started_at and completed_at', () => {
    const generation = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      started_at: '2026-03-01T10:00:00Z',
      completed_at: '2026-03-01T10:00:01.250Z',
    } as GenerationDetail;

    expect(resolveGenerationLatencyMs(generation)).toBe(1250);
    expect(formatLatency(1250)).toBe('1.25 s');
  });

  it('returns undefined latency for invalid or negative ranges', () => {
    const invalid = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      started_at: 'bad-ts',
      completed_at: '2026-03-01T10:00:01.250Z',
    } as GenerationDetail;
    const negative = {
      generation_id: 'gen-2',
      conversation_id: 'conv-1',
      started_at: '2026-03-01T10:00:02.000Z',
      completed_at: '2026-03-01T10:00:01.000Z',
    } as GenerationDetail;

    expect(resolveGenerationLatencyMs(invalid)).toBeUndefined();
    expect(resolveGenerationLatencyMs(negative)).toBeUndefined();
  });

  it('computes cost from usage and resolved pricing', () => {
    const generation = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      model: { provider: 'openai', name: 'gpt-4o-mini' },
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        cache_read_input_tokens: 40,
        cache_write_tokens: 10,
      },
    } as GenerationDetail;

    const cost = resolveGenerationCostUsd(generation, pricingMap);
    expect(cost).toBeCloseTo(0.57);
  });

  it('returns empty display values when model pricing is unresolved', () => {
    const generation = {
      generation_id: 'gen-1',
      conversation_id: 'conv-1',
      model: { provider: 'anthropic', name: 'claude-unknown' },
      usage: { input_tokens: 100, output_tokens: 25 },
      started_at: '2026-03-01T10:00:00Z',
      completed_at: '2026-03-01T10:00:02Z',
    } as GenerationDetail;

    const metrics = buildGenerationMetrics(generation, pricingMap);
    expect(metrics.tokenDisplay).toBe('125');
    expect(metrics.latencyDisplay).toBe('2.00 s');
    expect(metrics.costDisplay).toBe('—');
  });
});
