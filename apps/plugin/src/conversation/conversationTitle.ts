import type { GenerationDetail } from '../generation/types';
import { ATTR_CONVERSATION_TITLE, ATTR_CONVERSATION_TITLE_LEGACY, getStringAttr } from './attributes';
import type { ConversationSpan } from './types';

function normalizeTitle(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.stringValue === 'string') {
      const trimmed = record.stringValue.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }

  return null;
}

function titleFromMetadata(metadata?: Record<string, unknown>): string | null {
  if (!metadata) {
    return null;
  }

  const direct = normalizeTitle(metadata[ATTR_CONVERSATION_TITLE]);
  if (direct) {
    return direct;
  }

  const legacyDirect = normalizeTitle(metadata[ATTR_CONVERSATION_TITLE_LEGACY]);
  if (legacyDirect) {
    return legacyDirect;
  }

  const nestedAttributes = metadata.attributes;
  if (!nestedAttributes || typeof nestedAttributes !== 'object' || Array.isArray(nestedAttributes)) {
    return null;
  }

  const nested = normalizeTitle((nestedAttributes as Record<string, unknown>)[ATTR_CONVERSATION_TITLE]);
  if (nested) {
    return nested;
  }

  return normalizeTitle((nestedAttributes as Record<string, unknown>)[ATTR_CONVERSATION_TITLE_LEGACY]);
}

function titleFromSpan(span: ConversationSpan): string | null {
  const spanAttrTitle = getStringAttr(span.attributes, ATTR_CONVERSATION_TITLE)?.trim();
  if (spanAttrTitle && spanAttrTitle.length > 0) {
    return spanAttrTitle;
  }

  const resourceAttrTitle = getStringAttr(span.resourceAttributes, ATTR_CONVERSATION_TITLE)?.trim();
  if (resourceAttrTitle && resourceAttrTitle.length > 0) {
    return resourceAttrTitle;
  }

  return titleFromMetadata(span.generation?.metadata);
}

function generationCreatedAtMs(generation: GenerationDetail): number | null {
  if (typeof generation.created_at !== 'string') {
    return null;
  }
  const parsed = Date.parse(generation.created_at);
  return Number.isFinite(parsed) ? parsed : null;
}

function titleFromLatestGeneration(generations: GenerationDetail[]): string | null {
  let bestTitle: string | null = null;
  let bestTimestamp: number | null = null;
  let bestIndex = -1;

  generations.forEach((generation, index) => {
    const title = titleFromMetadata(generation.metadata);
    if (!title) {
      return;
    }

    const timestamp = generationCreatedAtMs(generation);
    if (bestTitle === null) {
      bestTitle = title;
      bestTimestamp = timestamp;
      bestIndex = index;
      return;
    }

    if (timestamp !== null) {
      if (bestTimestamp === null || timestamp > bestTimestamp || (timestamp === bestTimestamp && index > bestIndex)) {
        bestTitle = title;
        bestTimestamp = timestamp;
        bestIndex = index;
      }
      return;
    }

    if (bestTimestamp === null && index > bestIndex) {
      bestTitle = title;
      bestIndex = index;
    }
  });

  return bestTitle;
}

function titleFromLatestSpans(spans: ConversationSpan[]): string | null {
  const stack = [...spans];
  let bestTitle: string | null = null;
  let bestStart: bigint | null = null;
  let bestOrder = -1;
  let order = 0;

  while (stack.length > 0) {
    const span = stack.shift();
    if (!span) {
      continue;
    }

    const title = titleFromSpan(span);
    if (title) {
      if (
        bestStart === null ||
        span.startTimeUnixNano > bestStart ||
        (span.startTimeUnixNano === bestStart && order > bestOrder)
      ) {
        bestTitle = title;
        bestStart = span.startTimeUnixNano;
        bestOrder = order;
      }
    }

    if (span.children.length > 0) {
      stack.unshift(...span.children);
    }
    order += 1;
  }

  return bestTitle;
}

export function resolveConversationTitleFromTelemetry(
  generations: GenerationDetail[],
  spans: ConversationSpan[]
): string | null {
  const latestGenerationTitle = titleFromLatestGeneration(generations);
  if (latestGenerationTitle) {
    return latestGenerationTitle;
  }

  return titleFromLatestSpans(spans);
}
