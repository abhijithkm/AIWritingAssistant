import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPORT_KEY, clearReport, loadReport, saveReport } from '../src/report/report-store';
import { makeReport } from './helpers/meet-report';

afterEach(() => vi.unstubAllGlobals());

function stubSession(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const session = {
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
    remove: vi.fn(async (key: string) => { delete data[key]; }),
  };
  vi.stubGlobal('chrome', { storage: { session } });
  return { data, session };
}

describe('report store', () => {
  it('saves a report to session storage and loads it back', async () => {
    const { data, session } = stubSession();
    const report = makeReport();
    await saveReport(report);
    expect(session.set).toHaveBeenCalledWith({ [REPORT_KEY]: report });
    expect(data[REPORT_KEY]).toEqual(report);
    await expect(loadReport()).resolves.toEqual(report);
  });

  it('returns null when nothing is stored or the stored value is not a report', async () => {
    stubSession();
    await expect(loadReport()).resolves.toBeNull();
    stubSession({ [REPORT_KEY]: 'garbage' });
    await expect(loadReport()).resolves.toBeNull();
    stubSession({ [REPORT_KEY]: { generatedAt: 1 } });
    await expect(loadReport()).resolves.toBeNull();
  });

  it('deletes the report', async () => {
    const { data } = stubSession({ [REPORT_KEY]: makeReport() });
    await clearReport();
    expect(data[REPORT_KEY]).toBeUndefined();
    await expect(loadReport()).resolves.toBeNull();
  });

  it('explains when session storage is unavailable or full', async () => {
    vi.stubGlobal('chrome', { storage: {} });
    await expect(saveReport(makeReport())).rejects.toThrow('session storage');

    const { session } = stubSession();
    session.set.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
    await expect(saveReport(makeReport())).rejects.toThrow('could not be saved');
  });
});
