import type { GenerationDetail } from '../generation/types';
import { ATTR_CONVERSATION_TITLE, getStringAttr } from './attributes';
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

  const nestedAttributes = metadata.attributes;
  if (!nestedAttributes || typeof nestedAttributes !== 'object' || Array.isArray(nestedAttributes)) {
    return null;
  }

  return normalizeTitle((nestedAttributes as Record<string, unknown>)[ATTR_CONVERSATION_TITLE]);
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

function titleFromSpans(spans: ConversationSpan[]): string | null {
  const stack = [...spans];
  while (stack.length > 0) {
    const span = stack.shift();
    if (!span) {
      continue;
    }

    const title = titleFromSpan(span);
    if (title) {
      return title;
    }

    if (span.children.length > 0) {
      stack.unshift(...span.children);
    }
  }
  return null;
}

export function resolveConversationTitleFromTelemetry(
  generations: GenerationDetail[],
  spans: ConversationSpan[]
): string | null {
  for (const generation of generations) {
    const title = titleFromMetadata(generation.metadata);
    if (title) {
      return title;
    }
  }

  return titleFromSpans(spans);
}
