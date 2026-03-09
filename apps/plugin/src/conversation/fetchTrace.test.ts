import { of, throwError } from 'rxjs';
import { dateTime } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { createTempoTraceFetcher, fetchTempoTrace } from './fetchTrace';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

describe('fetchTempoTrace', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    (getBackendSrv as jest.Mock).mockReturnValue({ fetch: fetchMock });
  });

  it('adds bounded start and end query params when a time range is provided', async () => {
    fetchMock.mockReturnValue(of({ data: { ok: true } }));

    const fetchTrace = createTempoTraceFetcher();
    await fetchTrace('trace-1', {
      timeRange: {
        from: dateTime('2026-03-09T13:18:03Z'),
        to: dateTime('2026-03-09T13:28:15Z'),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      showErrorAlert: false,
    });
    expect(fetchMock.mock.calls[0][0].url).toContain(
      '/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/api/v2/traces/trace-1'
    );
    expect(fetchMock.mock.calls[0][0].url).toContain('start=1773062283');
    expect(fetchMock.mock.calls[0][0].url).toContain('end=1773062895');
  });

  it('retries once without bounds when the bounded lookup returns 404', async () => {
    fetchMock.mockReturnValueOnce(throwError(() => ({ status: 404 }))).mockReturnValueOnce(of({ data: { ok: true } }));

    await expect(
      fetchTempoTrace('trace-1', {
        timeRange: {
          from: dateTime('2026-03-09T13:18:03Z'),
          to: dateTime('2026-03-09T13:28:15Z'),
        },
      })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0].url).toContain('start=');
    expect(fetchMock.mock.calls[1][0].url).not.toContain('start=');
  });
});
