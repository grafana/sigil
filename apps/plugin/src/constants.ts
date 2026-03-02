export const PLUGIN_BASE = '/a/grafana-sigil-app';

export const ROUTES = {
  Root: '',
  Dashboard: 'dashboard',
  Conversations: 'conversations',
  Completions: 'completions',
  Traces: 'traces',
  Evaluation: 'evaluation',
  Settings: 'settings',
} as const;

export const PAGE_TITLES = {
  [ROUTES.Dashboard]: 'Dashboard',
  [ROUTES.Conversations]: 'Conversations',
  [ROUTES.Completions]: 'Completions',
  [ROUTES.Traces]: 'Traces',
  [ROUTES.Evaluation]: 'Evaluation',
  [ROUTES.Settings]: 'Settings',
} as const;
