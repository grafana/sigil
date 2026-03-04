export const PLUGIN_BASE = '/a/grafana-sigil-app';

export const ROUTES = {
  Root: '',
  Dashboard: 'dashboard',
  Landing1: 'landing1',
  Conversations: 'conversations',
  ConversationsView: 'conversations/:conversationID/view',
  ConversationsOld: 'conversations-old',
  ConversationsDetail: 'conversations/:conversationID/detail',
  Evaluation: 'evaluation',
} as const;

export const PAGE_TITLES = {
  [ROUTES.Dashboard]: 'Dashboard',
  [ROUTES.Landing1]: 'Landing 1',
  [ROUTES.Conversations]: 'Conversations',
  [ROUTES.ConversationsView]: 'Conversation view',
  [ROUTES.ConversationsOld]: 'Conversations (old)',
  [ROUTES.ConversationsDetail]: 'Conversation detail',
  [ROUTES.Evaluation]: 'Evaluation',
} as const;

export function buildConversationDetailRoute(conversationID: string): string {
  return `${ROUTES.Conversations}/${encodeURIComponent(conversationID)}/detail`;
}

export function buildConversationViewRoute(conversationID: string): string {
  return `${ROUTES.Conversations}/${encodeURIComponent(conversationID)}/view`;
}
