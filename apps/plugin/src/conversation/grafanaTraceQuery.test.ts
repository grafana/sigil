import { dateTime } from '@grafana/data';
import { buildGrafanaTraceQuery } from './grafanaTraceQuery';

describe('buildGrafanaTraceQuery', () => {
  it('uses traceql with a normalized hex trace id and bounded time range', () => {
    const query = buildGrafanaTraceQuery('xUbNuB2T/N4G7osnjrigXQ==', {
      from: dateTime('2026-03-09T13:18:03.897Z'),
      to: dateTime('2026-03-09T13:28:15.316Z'),
      raw: {
        from: '2026-03-09T13:18:03.897Z',
        to: '2026-03-09T13:28:15.316Z',
      },
    });

    expect(query).toEqual({
      refId: 'A',
      query: 'c546cdb81d93fcde06ee8b278eb8a05d',
      queryType: 'traceql',
      start: 1773062283,
      end: 1773062895,
    });
  });
});
