export const PLUGIN_BASE = '/a/grafana-sigil-app';

export const ROUTES = {
  Root: '',
  Dashboard: 'dashboard',
  Conversations: 'conversations',
  ConversationsOld: 'conversations-old',
  ConversationsDetail: 'conversations/:conversationID/detail',
  Completions: 'completions',
  Traces: 'traces',
  Evaluation: 'evaluation',
  Settings: 'settings',
} as const;

export const PAGE_TITLES = {
  [ROUTES.Dashboard]: 'Dashboard',
  [ROUTES.Conversations]: 'Conversations',
  [ROUTES.ConversationsOld]: 'Conversations (old)',
  [ROUTES.ConversationsDetail]: 'Conversation detail',
  [ROUTES.Completions]: 'Completions',
  [ROUTES.Traces]: 'Traces',
  [ROUTES.Evaluation]: 'Evaluation',
  [ROUTES.Settings]: 'Settings',
} as const;

export function buildConversationDetailRoute(conversationID: string): string {
  return `${ROUTES.Conversations}/${encodeURIComponent(conversationID)}/detail`;
}
