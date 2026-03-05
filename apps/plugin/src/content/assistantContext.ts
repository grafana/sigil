import { createAssistantContextItem, type ChatContextItem } from '@grafana/assistant';
import { sigilProjectContext } from './sigilProjectContext';

const PROJECT_CONTEXT_HEADER = 'Sigil knowledgebase';

export function buildSigilAssistantPrompt(userPrompt: string): string {
  return userPrompt.trim();
}

export function buildSigilAssistantContextItems(): ChatContextItem[] {
  return [
    createAssistantContextItem('structured', {
      title: PROJECT_CONTEXT_HEADER,
      bypassLimits: true,
      data: {
        name: PROJECT_CONTEXT_HEADER,
        text: sigilProjectContext,
      },
    }),
  ];
}

// URL fallback path cannot pass structured context, so embed it in text.
export function withSigilProjectContextFallback(userPrompt: string): string {
  const prompt = userPrompt.trim();
  if (prompt.length === 0) {
    return '';
  }
  return [
    'You are answering questions about Grafana Sigil. Use the context below as authoritative background information.',
    '',
    `--- ${PROJECT_CONTEXT_HEADER} (ground truth) ---`,
    sigilProjectContext,
    `--- End ${PROJECT_CONTEXT_HEADER} ---`,
    '',
    'User request:',
    prompt,
  ].join('\n');
}
