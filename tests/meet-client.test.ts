import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetUnavailableError, fetchMeetReport, fetchMeetText, pollMeetState, runMeetCommand } from '../src/popup/meet-client';
import { makeReport } from './helpers/meet-report';
import { makeSnapshot } from './helpers/meet-snapshot';

afterEach(() => vi.unstubAllGlobals());

function stubChrome(sendMessage: ReturnType<typeof vi.fn>, tabs: Array<{ id?: number }> = [{ id: 7 }]) {
  const query = vi.fn().mockResolvedValue(tabs);
  vi.stubGlobal('chrome', { tabs: { query, sendMessage } });
  return { query, sendMessage };
}

describe('meet client', () => {
  it('sends commands to the active tab and returns the snapshot', async () => {
    const snapshot = makeSnapshot({ phase: 'active' });
    const { query, sendMessage } = stubChrome(vi.fn().mockResolvedValue({ ok: true, snapshot }));
    await expect(runMeetCommand({ type: 'MEET_START' })).resolves.toEqual(snapshot);
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'MEET_START' });
  });

  it('reports "not on Meet" when no content script answers or there is no tab', async () => {
    stubChrome(vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.')));
    await expect(pollMeetState()).rejects.toBeInstanceOf(MeetUnavailableError);
    await expect(pollMeetState()).rejects.toThrow('Open a Google Meet meeting');

    stubChrome(vi.fn(), [{}]);
    await expect(pollMeetState()).rejects.toBeInstanceOf(MeetUnavailableError);

    stubChrome(vi.fn().mockResolvedValue(undefined));
    await expect(pollMeetState()).rejects.toBeInstanceOf(MeetUnavailableError);
  });

  it('returns the tab id with a null snapshot for an unchanged poll, and the snapshot otherwise', async () => {
    const snapshot = makeSnapshot({ version: 4 });
    const { sendMessage } = stubChrome(vi.fn()
      .mockResolvedValueOnce({ ok: true, unchanged: true, version: 4 })
      .mockResolvedValueOnce({ ok: true, snapshot }));
    await expect(pollMeetState({ tabId: 7, version: 4 })).resolves.toEqual({ tabId: 7, snapshot: null });
    await expect(pollMeetState({ tabId: 7, version: 3 })).resolves.toEqual({ tabId: 7, snapshot });
    expect(sendMessage).toHaveBeenNthCalledWith(1, 7, { type: 'MEET_GET_STATE', sinceVersion: 4 });
  });

  it('never reuses a version number from a different tab, so switching tabs shows the new tab', async () => {
    const snapshot = makeSnapshot({ version: 4 });
    const { sendMessage, query } = stubChrome(vi.fn().mockResolvedValue({ ok: true, snapshot }));
    query.mockResolvedValue([{ id: 8 }]);
    await expect(pollMeetState({ tabId: 7, version: 4 })).resolves.toEqual({ tabId: 8, snapshot });
    expect(sendMessage).toHaveBeenCalledWith(8, { type: 'MEET_GET_STATE', sinceVersion: undefined });
  });

  it('talks to the browser window behind a detached window, not to the detached window itself', async () => {
    const snapshot = makeSnapshot({ phase: 'active' });
    const query = vi.fn().mockResolvedValue([{ id: 11 }]);
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, snapshot });
    vi.stubGlobal('chrome', {
      tabs: { query, sendMessage },
      windows: {
        getCurrent: vi.fn().mockResolvedValue({ id: 5, type: 'popup' }),
        getLastFocused: vi.fn().mockResolvedValue({ id: 2, type: 'normal' }),
      },
    });
    await expect(runMeetCommand({ type: 'MEET_STOP' })).resolves.toEqual(snapshot);
    expect(query).toHaveBeenCalledWith({ active: true, windowId: 2 });
    expect(sendMessage).toHaveBeenCalledWith(11, { type: 'MEET_STOP' });
  });

  it('turns an error reply into a thrown message', async () => {
    stubChrome(vi.fn().mockResolvedValue({ ok: false, error: 'Open a Google Meet meeting first.' }));
    await expect(runMeetCommand({ type: 'MEET_START' })).rejects.toThrow('Open a Google Meet meeting first.');
  });

  it('fetches the full report', async () => {
    const report = makeReport();
    const { sendMessage } = stubChrome(vi.fn().mockResolvedValue({ ok: true, report }));
    await expect(fetchMeetReport()).resolves.toEqual(report);
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'MEET_GET_REPORT' });

    stubChrome(vi.fn().mockResolvedValue({ ok: true, text: 'not a report' }));
    await expect(fetchMeetReport()).rejects.toThrow('did not return');
  });

  it('fetches transcript and debug text', async () => {
    const { sendMessage } = stubChrome(vi.fn().mockResolvedValue({ ok: true, text: 'Google Meet transcript (captions)\n[00:00] A: Hi.' }));
    await expect(fetchMeetText('MEET_GET_TRANSCRIPT')).resolves.toContain('[00:00] A: Hi.');
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'MEET_GET_TRANSCRIPT' });
  });
});
