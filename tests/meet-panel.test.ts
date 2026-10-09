import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MeetPanel from '../src/popup/MeetPanel';
import * as client from '../src/popup/meet-client';
import { saveReport } from '../src/report/report-store';
import type { MeetSnapshot } from '../src/meet/types';
import { makeReport } from './helpers/meet-report';
import { makeSnapshot } from './helpers/meet-snapshot';

vi.mock('../src/popup/meet-client', () => {
  class MeetUnavailableError extends Error {
    constructor() { super('Open a Google Meet meeting in this tab to use Meet Assistant. If Meet is already open, refresh the tab once.'); }
  }
  return { MeetUnavailableError, pollMeetState: vi.fn(), runMeetCommand: vi.fn(), fetchMeetText: vi.fn(), fetchMeetReport: vi.fn() };
});
vi.mock('../src/report/report-store', () => ({ REPORT_KEY: 'aiWriterMeetReport', saveReport: vi.fn(), loadReport: vi.fn(), clearReport: vi.fn() }));

const CONSENT = 'Meet Assistant processes the captions currently visible in Google Meet. AI analysis may send selected transcript text to OpenRouter.';
const entries = [
  { id: 'e1', speaker: 'John', text: 'We should release this on Friday.', timestamp: 1_000 },
  { id: 'e2', speaker: 'Sarah', text: 'I agree.', timestamp: 2_000 },
];

describe('MeetPanel', () => {
  let container: HTMLElement;
  let root: Root;
  let onOpenSettings: ReturnType<typeof vi.fn>;
  const poll = vi.mocked(client.pollMeetState);
  const run = vi.mocked(client.runMeetCommand);
  const fetchText = vi.mocked(client.fetchMeetText);

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.clearAllMocks();
    onOpenSettings = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const text = () => container.textContent ?? '';
  const buttonByText = (pattern: RegExp) => Array.from(container.querySelectorAll('button')).find((b) => pattern.test(b.textContent ?? ''));
  const tabByName = (name: string) => Array.from(container.querySelectorAll('[role="tab"]')).find((t) => (t.textContent ?? '').startsWith(name)) as HTMLElement;
  const click = async (element: Element | undefined) => {
    expect(element).toBeDefined();
    await act(async () => { (element as HTMLElement).click(); });
  };
  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

  async function mount(state: MeetSnapshot | Error) {
    if (state instanceof Error) poll.mockRejectedValue(state);
    else {
      poll.mockResolvedValue({ tabId: 1, snapshot: state });
      run.mockResolvedValue(state);
    }
    await act(async () => { root.render(createElement(MeetPanel, { onOpenSettings })); });
    await flush();
  }

  it('asks the user to open a Meet tab when the page cannot be reached', async () => {
    await mount(new client.MeetUnavailableError());
    expect(text()).toContain('Open a Google Meet meeting in this tab');
  });

  it('shows the detected meeting with caption and assistant status, and a Start button', async () => {
    await mount(makeSnapshot());
    expect(text()).toContain('Meeting detected');
    expect(text()).toMatch(/Captions.*On/);
    expect(text()).toMatch(/Assistant.*Stopped/);
    expect(buttonByText(/^Start Assistant$/)).toBeDefined();
  });

  it('requires explicit consent before starting', async () => {
    await mount(makeSnapshot());
    await click(buttonByText(/^Start Assistant$/));
    expect(text()).toContain(CONSENT);
    expect(run).not.toHaveBeenCalled();

    await click(buttonByText(/^Cancel$/));
    expect(text()).not.toContain(CONSENT);
    expect(run).not.toHaveBeenCalled();

    await click(buttonByText(/^Start Assistant$/));
    await click(buttonByText(/^Start Assistant$/));
    expect(run).toHaveBeenCalledWith({ type: 'MEET_START' });
  });

  it('says plainly what the AI buttons send and asks the user to tell the other participants', async () => {
    await mount(makeSnapshot());
    await click(buttonByText(/^Start Assistant$/));
    expect(text()).toContain('send the transcript so far');
    expect(text()).toContain('Tell the other participants');
  });

  it('tells the user to turn captions on when they are off', async () => {
    await mount(makeSnapshot({ page: { meetingDetected: true, meetingCode: 'abc-defg-hij', captions: 'off' } }));
    expect(text()).toContain('Captions are currently disabled. Turn on captions in Google Meet to use Meet Assistant.');
  });

  it('cannot start away from a meeting', async () => {
    await mount(makeSnapshot({ page: { meetingDetected: false, meetingCode: null, captions: 'unknown' } }));
    expect(text()).toContain('Join or start a meeting');
    expect((buttonByText(/^Start Assistant$/) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the active indicator, live transcript and a Stop button', async () => {
    await mount(makeSnapshot({ phase: 'active', startedAt: 1_000, entryCount: 2, recentEntries: entries }));
    expect(text()).toContain('Meet Assistant active');
    expect(text()).toContain('John');
    expect(text()).toContain('We should release this on Friday.');
    expect(text()).toContain('Sarah');
    expect(['Live', 'Summary', 'Actions', 'Decisions', 'Questions'].every((name) => tabByName(name))).toBe(true);

    await click(buttonByText(/^Stop Assistant$/));
    expect(run).toHaveBeenCalledWith({ type: 'MEET_STOP' });
  });

  it('limits what it renders for very long meetings and says so', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `e${i + 1}`, speaker: 'A', text: `line ${i + 1}`, timestamp: i }));
    await mount(makeSnapshot({ phase: 'active', entryCount: 5_000, recentEntries: many }));
    expect(container.querySelectorAll('.transcript li')).toHaveLength(100);
    expect(text()).toContain('Showing the latest 100 of 5000 lines');
  });

  it('runs the summary only when asked', async () => {
    await mount(makeSnapshot({ phase: 'active', entryCount: 2, recentEntries: entries, unanalyzed: { summary: 2, actions: 2, decisions: 2, questions: 2 } }));
    await click(tabByName('Summary'));
    expect(run).not.toHaveBeenCalled();
    await click(buttonByText(/^Summarize$/));
    expect(run).toHaveBeenCalledWith({ type: 'MEET_ANALYZE', task: 'summary' });
  });

  it('shows the current topic, key points and summary', async () => {
    await mount(makeSnapshot({
      phase: 'active', entryCount: 2, recentEntries: entries, summary: 'The team planned a Friday release.',
      keyPoints: ['Release on Friday'], topics: ['Intro', 'Release planning'],
    }));
    await click(tabByName('Summary'));
    expect(text()).toContain('Current topic: Release planning');
    expect(text()).toContain('The team planned a Friday release.');
    expect(text()).toContain('Release on Friday');
  });

  it('lists action items with owner and source lines, plus decisions and questions', async () => {
    await mount(makeSnapshot({
      phase: 'active', entryCount: 2, recentEntries: entries,
      actionItems: [{ id: 'a1', task: 'Update API documentation', owner: 'Abhijith', deadline: 'Thursday', sourceEntryIds: ['e1', 'e2'] }],
      decisions: [{ id: 'd1', decision: 'Release on Friday', sourceEntryIds: [] }],
      questions: [{ id: 'q1', question: 'Who owns rollback?', status: 'open', sourceEntryIds: [] }],
      unanalyzed: { summary: 0, actions: 0, decisions: 0, questions: 0 },
    }));
    await click(tabByName('Actions'));
    expect(text()).toContain('Update API documentation');
    expect(text()).toContain('Owner: Abhijith');
    expect(text()).toContain('Due: Thursday');
    expect(text()).toContain('Lines #1, #2');
    await click(buttonByText(/Find Action Items/));
    expect(run).toHaveBeenCalledWith({ type: 'MEET_ANALYZE', task: 'actions' });

    await click(tabByName('Decisions'));
    expect(text()).toContain('Release on Friday');
    await click(buttonByText(/Find Decisions/));
    expect(run).toHaveBeenCalledWith({ type: 'MEET_ANALYZE', task: 'decisions' });

    await click(tabByName('Questions'));
    expect(text()).toContain('Who owns rollback?');
    expect(text()).toContain('open');
    await click(buttonByText(/Find Questions/));
    expect(run).toHaveBeenCalledWith({ type: 'MEET_ANALYZE', task: 'questions' });
  });

  it('distinguishes "nothing found" from "not generated yet"', async () => {
    await mount(makeSnapshot({
      phase: 'active', entryCount: 3, recentEntries: entries,
      unanalyzed: { summary: 3, actions: 3, decisions: 3, questions: 3 },
      // Decisions ran once and the first lines have since grown, so "unanalyzed" is high but the run did happen.
      analyzed: { summary: false, actions: false, decisions: true, questions: false },
    }));
    await click(tabByName('Actions'));
    expect(text()).toContain('Not generated yet');
    await click(tabByName('Decisions'));
    expect(text()).toContain('No decisions found');
    expect(text()).toContain('3 new lines since the last run');
  });

  it('shows an unparseable AI reply as-is with an explanation', async () => {
    await mount(makeSnapshot({
      phase: 'active', entryCount: 2, recentEntries: entries,
      raw: { summary: 'The meeting was about releasing.' },
      errors: { summary: 'The AI reply was not in the expected format.' },
    }));
    await click(tabByName('Summary'));
    expect(text()).toContain('The AI reply was not in the expected format.');
    expect(text()).toContain('The meeting was about releasing.');
  });

  it('offers settings when the API key is missing', async () => {
    await mount(makeSnapshot({ phase: 'active', entryCount: 2, recentEntries: entries, errors: { summary: 'Add your OpenRouter API key in the extension settings.' } }));
    await click(tabByName('Summary'));
    await click(buttonByText(/Open settings/));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('disables the busy action and shows progress', async () => {
    await mount(makeSnapshot({ phase: 'active', entryCount: 2, recentEntries: entries, busy: { summary: true } }));
    await click(tabByName('Summary'));
    expect((buttonByText(/Summariz/) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks questions about the meeting and shows answers', async () => {
    await mount(makeSnapshot({
      phase: 'active', entryCount: 2, recentEntries: entries,
      qa: [{ id: 'qa1', question: 'What did we decide?', answer: 'The team agreed to release on Friday.', error: null, pending: false }],
    }));
    expect(text()).toContain('The team agreed to release on Friday.');

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Ask the meeting"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Who owns rollback?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonByText(/^Ask$/));
    expect(run).toHaveBeenCalledWith({ type: 'MEET_ASK', question: 'Who owns rollback?' });
  });

  it('cannot ask before any captions exist', async () => {
    await mount(makeSnapshot({ phase: 'active', entryCount: 0 }));
    expect((buttonByText(/^Ask$/) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the meeting-complete summary with copy and follow-up actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fetchText.mockResolvedValue('Google Meet transcript (captions)\n[00:00] John: We should release this on Friday.');

    await mount(makeSnapshot({
      phase: 'stopped', startedAt: 0, endedAt: 23 * 60_000 + 20_000, entryCount: 142, recentEntries: entries,
      summary: 'The team planned a Friday release.', keyPoints: ['Release on Friday'],
    }));
    expect(text()).toContain('Meeting complete');
    expect(text()).toContain('Duration: 23 minutes');
    expect(text()).toContain('Transcript: 142 entries');

    await click(buttonByText(/^Copy Summary$/));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('The team planned a Friday release.'));

    await click(buttonByText(/^Copy Transcript$/));
    expect(fetchText).toHaveBeenCalledWith('MEET_GET_TRANSCRIPT');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[00:00] John:'));

    await click(buttonByText(/^Generate Follow-up Email$/));
    expect(run).toHaveBeenCalledWith({ type: 'MEET_ANALYZE', task: 'email' });
  });

  it('shows the generated follow-up email and lets the user copy it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount(makeSnapshot({
      phase: 'stopped', startedAt: 0, endedAt: 60_000, entryCount: 2, recentEntries: entries,
      followUpEmail: 'Subject: Follow-up — Release\n\nHi everyone,',
    }));
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Follow-up email"]')!.value).toContain('Subject: Follow-up — Release');
    await click(buttonByText(/^Copy Email$/));
    expect(writeText).toHaveBeenCalledWith('Subject: Follow-up — Release\n\nHi everyone,');
  });

  it('offers the full report only once the meeting is complete', async () => {
    await mount(makeSnapshot({ phase: 'active', startedAt: 0, entryCount: 2, recentEntries: entries }));
    expect(buttonByText(/^Open full report$/)).toBeUndefined();
  });

  it('explains that the report shows the transcript and lets the user generate anything missing', async () => {
    await mount(makeSnapshot({ phase: 'stopped', startedAt: 0, endedAt: 60_000, entryCount: 2, recentEntries: entries }));
    expect(text()).toContain('You can generate the rest on the report page');
  });

  it('saves the report for the report page, then opens it in a new tab', async () => {
    const report = makeReport();
    vi.mocked(client.fetchMeetReport).mockResolvedValue(report);
    vi.mocked(saveReport).mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { tabs: { create }, runtime: { getURL: (path: string) => `chrome-extension://abc/${path}` } });
    try {
      await mount(makeSnapshot({ phase: 'stopped', startedAt: 0, endedAt: 60_000, entryCount: 3, recentEntries: entries }));
      await click(buttonByText(/^Open full report$/));

      expect(client.fetchMeetReport).toHaveBeenCalled();
      expect(saveReport).toHaveBeenCalledWith(report);
      expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://abc/report.html' });
      expect(vi.mocked(saveReport).mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows the problem and opens nothing when the report cannot be saved', async () => {
    vi.mocked(client.fetchMeetReport).mockResolvedValue(makeReport());
    vi.mocked(saveReport).mockRejectedValue(new Error('The report could not be saved. It may be too large for session storage.'));
    const create = vi.fn();
    vi.stubGlobal('chrome', { tabs: { create }, runtime: { getURL: (path: string) => path } });
    try {
      await mount(makeSnapshot({ phase: 'stopped', startedAt: 0, endedAt: 60_000, entryCount: 3, recentEntries: entries }));
      await click(buttonByText(/^Open full report$/));
      expect(text()).toContain('The report could not be saved');
      expect(create).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lets the user discard the transcript', async () => {
    await mount(makeSnapshot({ phase: 'stopped', startedAt: 0, endedAt: 60_000, entryCount: 2, recentEntries: entries }));
    await click(buttonByText(/^Discard transcript$/));
    expect(run).toHaveBeenCalledWith({ type: 'MEET_DISCARD' });
  });

  it('shows a notice such as leaving the meeting', async () => {
    await mount(makeSnapshot({ phase: 'stopped', startedAt: 0, endedAt: 60_000, entryCount: 2, recentEntries: entries, notice: 'Meet Assistant stopped because you left the meeting.' }));
    expect(text()).toContain('Meet Assistant stopped because you left the meeting.');
  });
});
