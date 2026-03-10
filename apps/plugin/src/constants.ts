export const PLUGIN_BASE = '/a/grafana-sigil-app';

export const ROUTES = {
  Root: '',
  PlaygroundSparkles: 'playground/sparkles',
  Analytics: 'analytics',
  Tutorial: 'tutorial',
  Conversations: 'conversations',
  ConversationsExplore: 'conversations/:conversationID/explore',
  Agents: 'agents',
  AgentDetailByName: 'agents/name/:agentName',
  AgentDetailAnonymous: 'agents/anonymous',
  Evaluation: 'evaluation',
} as const;

export function buildConversationExploreRoute(conversationID: string): string {
  return `${ROUTES.Conversations}/${encodeURIComponent(conversationID)}/explore`;
}

export function buildAgentDetailByNameRoute(agentName: string): string {
  return `${ROUTES.Agents}/name/${encodeURIComponent(agentName)}`;
}

export function buildAnonymousAgentDetailRoute(): string {
  return ROUTES.AgentDetailAnonymous;
}
