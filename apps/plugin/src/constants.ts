export const PLUGIN_BASE = '/a/grafana-sigil-app';

export const ROUTES = {
  Root: '',
  Dashboard: 'dashboard',
  Landing1: 'landing1',
  Conversations: 'conversations',
  ConversationsView: 'conversations/:conversationID/view',
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
  [ROUTES.ConversationsOld]: 'Conversations (old)',
  [ROUTES.ConversationsDetail]: 'Conversation detail',
  [ROUTES.Agents]: 'Agents',
  [ROUTES.AgentDetailByName]: 'Agent detail',
  [ROUTES.AgentDetailAnonymous]: 'Agent detail',
  [ROUTES.Evaluation]: 'Evaluation',
} as const;

export function buildConversationDetailRoute(conversationID: string): string {
  return `${ROUTES.Conversations}/${encodeURIComponent(conversationID)}/detail`;
}

export function buildConversationViewRoute(conversationID: string): string {
  return `${ROUTES.Conversations}/${encodeURIComponent(conversationID)}/view`;
}

export function buildAgentDetailByNameRoute(agentName: string): string {
  return `${ROUTES.Agents}/name/${encodeURIComponent(agentName)}`;
}

export function buildAnonymousAgentDetailRoute(): string {
  return ROUTES.AgentDetailAnonymous;
}
