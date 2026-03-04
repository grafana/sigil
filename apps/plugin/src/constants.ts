export const PLUGIN_BASE = '/a/grafana-sigil-app';

export const ROUTES = {
  Root: '',
  Dashboard: 'dashboard',
  Landing1: 'landing1',
  Conversations: 'conversations',
  ConversationsView: 'conversations/:conversationID/view',
  ConversationsExplore: 'conversations/:conversationID/explore',
  ConversationsOld: 'conversations-old',
  ConversationsDetail: 'conversations/:conversationID/detail',
  Agents: 'agents',
  AgentDetailByName: 'agents/name/:agentName',
  AgentDetailAnonymous: 'agents/anonymous',
  Evaluation: 'evaluation',
} as const;

export const PAGE_TITLES = {
  [ROUTES.Dashboard]: 'Dashboard',
  [ROUTES.Landing1]: 'Landing 1',
  [ROUTES.Conversations]: 'Conversations',
  [ROUTES.ConversationsView]: 'Conversation view',
  [ROUTES.ConversationsExplore]: 'Conversation explore',
  [ROUTES.ConversationsOld]: 'Conversations (old)',
  [ROUTES.ConversationsDetail]: 'Conversations',
  [ROUTES.Agents]: 'Agents',
  [ROUTES.AgentDetailByName]: 'Agents',
  [ROUTES.AgentDetailAnonymous]: 'Agents',
  [ROUTES.Evaluation]: 'Evaluation',
} as const;

export function buildConversationDetailRoute(conversationID: string): string {
  return `${ROUTES.Conversations}/${encodeURIComponent(conversationID)}/detail`;
}

export function buildConversationViewRoute(conversationID: string): string {
  return `${ROUTES.Conversations}/${encodeURIComponent(conversationID)}/view`;
}

export function buildConversationExploreRoute(conversationID: string): string {
  return `${ROUTES.Conversations}/${encodeURIComponent(conversationID)}/explore`;
}

export function buildAgentDetailByNameRoute(agentName: string): string {
  return `${ROUTES.Agents}/name/${encodeURIComponent(agentName)}`;
}

export function buildAnonymousAgentDetailRoute(): string {
  return ROUTES.AgentDetailAnonymous;
}
