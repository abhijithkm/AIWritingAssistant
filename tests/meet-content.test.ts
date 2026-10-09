import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetCommand, MeetReply, MeetSnapshot } from '../src/meet/types';

type Listener = (message: unknown, sender: { id?: string }, respond: (reply: MeetReply) => void) => boolean | void;

const SUMMARY = JSON.stringify({ summary: 'The team planned a Friday release.', keyPoints: ['Release Friday'], topics: ['Release'] });
const ACTIONS = JSON.stringify({ actionItems: [{ task: 'Update API documentation', owner: 'Abhijith', deadline: null, sources: [1] }] });
const DECISIONS = JSON.stringify({ decisions: [{ decision: 'Release on Friday', sources: [1] }] });
const QUESTIONS = JSON.stringify({ questions: [{ question: 'Who owns rollback?', status: 'open', sources: [2] }] });

function replyFor(system: string): string {
  if (system.includes('Summarize the meeting transcript')) return SUMMARY;
  if (system.includes('Extract action items')) return ACTIONS;
  if (system.includes('Extract decisions')) return DECISIONS;
  if (system.includes('Extract questions')) return QUESTIONS;
  if (system.includes('follow-up email')) return 'Subject: Follow-up — Release\n\nHi everyone,';
  return 'The team agreed to release on Friday.';
}

const block = (name: string, text: string) =>
  `<div class="blk"><div class="who"><span>${name}</span></div><div class="txt">${text}</div></div>`;

describe('Meet content script', () => {
  let listeners: Listener[];
  let aiRequests: Array<{ system: string; text: string }>;
  let storageGet: ReturnType<typeof vi.fn>;
  let dispose: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    document.body.innerHTML = '';
    document.documentElement.querySelectorAll('[data-ai-writer-meet-badge]').forEach((node) => node.remove());
    history.replaceState(null, '', '/abc-defg-hij');
    listeners = [];
    aiRequests = [];
    // The settings object holds the API key. Only the user-name key may ever be requested here.
    storageGet = vi.fn(async (key: string) => (key === 'aiWriterUserName'
      ? { aiWriterUserName: 'Abhijith' }
      : { aiWriterSettings: { apiKey: 'SECRET-KEY', model: 'm' } }));
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'ext-id',
        onMessage: {
          addListener: (listener: Listener) => listeners.push(listener),
          removeListener: (listener: Listener) => { listeners = listeners.filter((l) => l !== listener); },
        },
        sendMessage: vi.fn(async (message: { request: { system: string; text: string } }) => {
          aiRequests.push(message.request);
          return { ok: true, result: { text: replyFor(message.request.system) } };
        }),
      },
      storage: { local: { get: storageGet } },
    });
  });

  afterEach(() => {
    dispose?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function boot() {
    const { initMeetContent } = await import('../src/meet/meet-content');
    dispose = initMeetContent({ hostname: 'meet.google.com' });
  }

  const send = (command: MeetCommand, sender: { id?: string } = { id: 'ext-id' }) =>
    new Promise<MeetReply | 'ignored'>((resolve) => {
      const handled = listeners.map((listener) => listener(command, sender, resolve as (reply: MeetReply) => void));
      if (!handled.some(Boolean)) resolve('ignored');
    });
  const state = async (): Promise<MeetSnapshot> => {
    const reply = await send({ type: 'MEET_GET_STATE' });
    if (reply === 'ignored' || !('snapshot' in reply)) throw new Error('no snapshot');
    return reply.snapshot;
  };
  const captions = (...rows: Array<[string, string]>) => {
    let region = document.querySelector('[role="region"]');
    if (!region) {
      region = document.createElement('div');
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', 'Captions');
      document.body.append(region);
    }
    region.innerHTML = `<div>${rows.map(([name, text]) => block(name, text)).join('')}</div>`;
  };

  it('does nothing on sites that are not Google Meet', async () => {
    const { initMeetContent } = await import('../src/meet/meet-content');
    const stop = initMeetContent({ hostname: 'example.com' });
    expect(listeners).toHaveLength(0);
    expect(document.querySelector('[data-ai-writer-meet-badge]')).toBeNull();
    stop();
  });

  it('runs the whole flow: captions, transcript, analysis, questions, stop and follow-up email', async () => {
    document.body.innerHTML = '<button aria-label="Turn on captions (c)"></button>';
    await boot();

    let snapshot = await state();
    expect(snapshot.phase).toBe('idle');
    expect(snapshot.page).toEqual({ meetingDetected: true, meetingCode: 'abc-defg-hij', captions: 'off' });

    // The user turns captions on in Meet, then explicitly starts the assistant.
    document.body.innerHTML = '';
    captions();
    await vi.advanceTimersByTimeAsync(1_100);
    expect((await state()).page.captions).toBe('on');

    const started = await send({ type: 'MEET_START' });
    expect(started).toMatchObject({ ok: true, snapshot: { phase: 'active' } });
    const badge = document.querySelector<HTMLElement>('[data-ai-writer-meet-badge]');
    expect(badge).not.toBeNull();
    expect(badge!.style.display).toBe('block');

    // Meet shows captions word by word, then re-renders the same block into new elements.
    captions(['John', 'We should']);
    await vi.advanceTimersByTimeAsync(400);
    captions(['John', 'We should probably release this on Friday.']);
    await vi.advanceTimersByTimeAsync(2_000);
    captions(['John', 'We should probably release this on Friday.'], ['Sarah', 'Who owns the rollback plan?']);
    await vi.advanceTimersByTimeAsync(2_500);
    captions(['John', 'We should probably release this on Friday.'], ['Sarah', 'Who owns the rollback plan?']);
    await vi.advanceTimersByTimeAsync(2_500);

    snapshot = await state();
    expect(snapshot.recentEntries.map((e) => [e.speaker, e.text])).toEqual([
      ['John', 'We should probably release this on Friday.'],
      ['Sarah', 'Who owns the rollback plan?'],
    ]);
    // Captions alone never reach the AI.
    expect(aiRequests).toHaveLength(0);

    await send({ type: 'MEET_ANALYZE', task: 'summary' });
    await send({ type: 'MEET_ANALYZE', task: 'actions' });
    await send({ type: 'MEET_ANALYZE', task: 'decisions' });
    await send({ type: 'MEET_ANALYZE', task: 'questions' });
    await vi.waitFor(async () => {
      const s = await state();
      expect(s.summary).toBe('The team planned a Friday release.');
      expect(s.actionItems[0]).toMatchObject({ task: 'Update API documentation', owner: 'Abhijith', sourceEntryIds: ['e1'] });
      expect(s.decisions).toHaveLength(1);
      expect(s.questions[0]).toMatchObject({ question: 'Who owns rollback?', status: 'open' });
    });
    expect(aiRequests[0].system).toContain('Abhijith');
    expect(aiRequests[0].text).toContain('[1] John: We should probably release this on Friday.');
    // The key never reaches the Meet content script: it asks only for the user-name key.
    expect(storageGet).toHaveBeenCalledWith('aiWriterUserName');
    expect(storageGet).not.toHaveBeenCalledWith('aiWriterSettings');
    expect(JSON.stringify(aiRequests)).not.toContain('SECRET-KEY');

    await send({ type: 'MEET_ASK', question: 'What did we decide?' });
    await vi.waitFor(async () => expect((await state()).qa[0]?.answer).toBe('The team agreed to release on Friday.'));

    await send({ type: 'MEET_STOP' });
    snapshot = await state();
    expect(snapshot.phase).toBe('stopped');
    expect(snapshot.entryCount).toBe(2);
    expect(badge!.style.display).toBe('none');

    // Captions that appear after stopping are not recorded.
    captions(['John', 'We should probably release this on Friday.'], ['Sarah', 'Who owns the rollback plan?'], ['Dana', 'Added after stop.']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await state()).entryCount).toBe(2);

    await send({ type: 'MEET_ANALYZE', task: 'email' });
    await vi.waitFor(async () => expect((await state()).followUpEmail).toContain('Subject: Follow-up — Release'));

    const transcript = await send({ type: 'MEET_GET_TRANSCRIPT' });
    expect(transcript).toMatchObject({ ok: true });
    expect((transcript as { text: string }).text).toContain('Sarah: Who owns the rollback plan?');
  });

  it('returns the full report on request', async () => {
    captions(['John', 'We should release this on Friday after the tests.']);
    await boot();
    await send({ type: 'MEET_START' });
    await vi.advanceTimersByTimeAsync(2_500);
    await send({ type: 'MEET_STOP' });
    const reply = await send({ type: 'MEET_GET_REPORT' });
    expect(reply).toMatchObject({ ok: true, report: { meetingCode: 'abc-defg-hij' } });
    const entries = (reply as { report: { entries: Array<{ speaker: string; text: string }> } }).report.entries;
    expect(entries.map((e) => [e.speaker, e.text])).toEqual([['John', 'We should release this on Friday after the tests.']]);
  });

  it('refuses to start away from a meeting and reports the reason', async () => {
    history.replaceState(null, '', '/landing');
    await boot();
    const reply = await send({ type: 'MEET_START' });
    expect(reply).toMatchObject({ ok: false });
    expect((reply as { error: string }).error).toContain('Google Meet meeting');
  });

  it('stops the assistant when Meet navigates to another page without a reload', async () => {
    captions();
    await boot();
    await send({ type: 'MEET_START' });
    history.pushState(null, '', '/landing');
    await vi.advanceTimersByTimeAsync(1_100);
    const snapshot = await state();
    expect(snapshot.phase).toBe('stopped');
    expect(snapshot.notice).toContain('left the meeting');
  });

  it('answers unchanged polls cheaply and ignores foreign or unknown messages', async () => {
    await boot();
    const first = await state();
    expect(await send({ type: 'MEET_GET_STATE', sinceVersion: first.version })).toEqual({ ok: true, unchanged: true, version: first.version });
    expect(await send({ type: 'MEET_GET_STATE' }, { id: 'someone-else' })).toBe('ignored');
    expect(await send({ type: 'SOMETHING_ELSE' } as unknown as MeetCommand)).toBe('ignored');
    expect(await send({ type: 'MEET_ANALYZE', task: 'bogus' } as unknown as MeetCommand)).toMatchObject({ ok: false });
  });

  it('returns a redacted DOM report for selector debugging', async () => {
    captions(['Secret', 'Confidential words']);
    await boot();
    const reply = await send({ type: 'MEET_DEBUG_DUMP' });
    const text = (reply as { text: string }).text;
    expect(text).toContain('container: found');
    expect(text).not.toContain('Confidential');
    expect(text).not.toContain('abc-defg-hij');
  });
});
