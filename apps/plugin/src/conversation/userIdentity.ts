import type { ConversationData, ConversationSpan } from './types';

function readStringAttribute(span: ConversationSpan, key: string): string | undefined {
  const attrValue = span.attributes.get(key)?.stringValue?.trim();
  if (attrValue) {
    return attrValue;
  }

  const resourceValue = span.resourceAttributes.get(key)?.stringValue?.trim();
  if (resourceValue) {
    return resourceValue;
  }

  return undefined;
}

function looksEmailLike(value: string): boolean {
  return value.includes('@');
}

function looksHumanReadable(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

export function resolveConversationUserId(data: ConversationData | null | undefined): string | undefined {
  const canonicalUserId = data?.userID?.trim();
  if (canonicalUserId) {
    return canonicalUserId;
  }

  const candidates: string[] = [];
  for (const span of data?.spans ?? []) {
    for (const key of ['sigil.user.id', 'user.id']) {
      const value = readStringAttribute(span, key);
      if (value && !candidates.includes(value)) {
        candidates.push(value);
      }
    }
  }

  return candidates.find(looksEmailLike) ?? candidates.find(looksHumanReadable) ?? candidates[0];
}
