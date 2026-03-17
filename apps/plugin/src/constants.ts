export const PLUGIN_BASE = '/a/grafana-sigil-app';

export const ROUTES = {
  Root: '',
  PlaygroundSparkles: 'playground/sparkles',
  Analytics: 'analytics',
  AnalyticsTools: 'analytics/tools',
  AnalyticsTool: 'analytics/tools/:toolName',
  Tutorial: 'tutorial',
  Conversations: 'conversations',
  ConversationsSaved: 'conversations/saved',
  ConversationsExplore: 'conversations/:conversationID/explore',
  Agents: 'agents',
  AgentDetailByName: 'agents/name/:agentName',
  AgentDetailAnonymous: 'agents/anonymous',
  Evaluation: 'evaluation',
} as const;

export function buildConversationExploreRoute(conversationID: string): string {
  return `${ROUTES.Conversations}/${encodeURIComponent(conversationID)}/explore`;
}

export function buildToolAnalyticsRoute(toolName: string): string {
  return `${ROUTES.AnalyticsTools}/${encodeURIComponent(toolName)}`;
}

export function buildAgentDetailByNameRoute(agentName: string): string {
  return `${ROUTES.Agents}/name/${encodeURIComponent(agentName)}`;
}

export function buildAnonymousAgentDetailRoute(): string {
  return ROUTES.AgentDetailAnonymous;
}
