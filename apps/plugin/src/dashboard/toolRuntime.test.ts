import { sanitizeToolAnalyticsFilters, TOOL_METRIC_LABEL } from './toolRuntime';

describe('sanitizeToolAnalyticsFilters', () => {
  it('drops model filters and tool metric labels from tool analytics state', () => {
    const sanitized = sanitizeToolAnalyticsFilters({
      providers: ['openai'],
      models: ['gpt-4o'],
      agentNames: ['assistant'],
      labelFilters: [
        { key: TOOL_METRIC_LABEL, operator: '=', value: 'calendar.lookup' },
        { key: 'service_name', operator: '=', value: 'sigil' },
      ],
    });

    expect(sanitized).toEqual({
      providers: ['openai'],
      models: [],
      agentNames: ['assistant'],
      labelFilters: [{ key: 'service_name', operator: '=', value: 'sigil' }],
    });
  });
});
