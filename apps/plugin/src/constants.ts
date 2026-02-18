export const ROUTES = {
  Root: '',
  Dashboard: 'dashboard',
  Conversations: 'conversations',
  Completions: 'completions',
  Traces: 'traces',
  Settings: 'settings',
} as const;

export const PAGE_TITLES = {
  [ROUTES.Dashboard]: 'Dashboard',
  [ROUTES.Conversations]: 'Conversations',
  [ROUTES.Completions]: 'Completions',
  [ROUTES.Traces]: 'Traces',
  [ROUTES.Settings]: 'Settings',
} as const;
