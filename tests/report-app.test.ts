import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportApp from '../src/report/ReportApp';
import { clearReport, loadReport, saveReport } from '../src/report/report-store';
import type { AIProvider, AIRequest } from '../src/shared/types';
import { makeReport } from './helpers/meet-report';

const summaryJson = JSON.stringify({ summary: 'The team plans a Friday release.', keyPoints: ['Release Friday'], topics: ['Release planning'] });
const actionsJson = JSON.stringify({ actionItems: [{ task: 'Update the API documentation', owner: 'You', deadline: null, sources: [3] }] });
const decisionsJson = JSON.stringify({ decisions: [{ decision: 'Release on Friday', sources: [1] }] });
const questionsJson = JSON.stringify({ questions: [{ question: 'Who owns the rollback plan?', status: 'open', sources: [2] }] });
// A short meeting, so each analysis is a single AI request (a long one is split into chunks).
const SHORT_MEETING = [
  { id: 'e1', speaker: 'John', text: 'We should release this on Friday after the regression tests.', timestamp: 1_000_000 },
  { id: 'e2', speaker: 'Sarah', text: 'I agree. Who owns the rollback plan?', timestamp: 1_000_000 + 30_000 },
  { id: 'e3', speaker: 'You', text: 'I will update the API documentation before then.', timestamp: 1_000_000 + 60_000 },
];
const NOTHING_RUN = {
  entries: SHORT_MEETING,
  summary: null, keyPoints: [], topics: [], actionItems: [], decisions: [], questions: [], followUpEmail: null, qa: [],
  analyzed: { summary: false, actions: false, decisions: false, questions: false },
};

function fakeProvider(replies: Array<string | Error>) {
  const calls: AIRequest[] = [];
  const queue = [...replies];
  const provider: AIProvider = {
    async generate(request) {
      calls.push(request);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('No reply queued.');
      return { text: next };
    },
  };
  return { provider, calls };
}

vi.mock('../src/report/report-store', () => ({
  REPORT_KEY: 'aiWriterMeetReport',
  loadReport: vi.fn(),
  clearReport: vi.fn(),
  saveReport: vi.fn(),
}));

describe('ReportApp', () => {
  let container: HTMLElement;
  let root: Root;
  const load = vi.mocked(loadReport);
  const clear = vi.mocked(clearReport);

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const text = () => container.textContent ?? '';
  const button = (pattern: RegExp) => Array.from(container.querySelectorAll('button')).find((b) => pattern.test(b.textContent ?? ''));
  const click = async (element: Element | undefined) => {
    expect(element).toBeDefined();
    await act(async () => { (element as HTMLElement).click(); });
  };
  async function mount(report: ReturnType<typeof makeReport> | null, provider?: AIProvider) {
    load.mockResolvedValue(report);
    vi.mocked(saveReport).mockResolvedValue(undefined);
    await act(async () => { root.render(createElement(ReportApp, { provider })); });
  }

  it('says so when there is no report to show', async () => {
    await mount(null);
    expect(text()).toContain('No report found');
    expect(text()).toContain('Open full report');
  });

  it('credits the developer with a link to their site', async () => {
    await mount(makeReport());
    expect(text()).toContain('Developed by Abhijith KM');
    expect(container.querySelector('a[href="https://abhijithkm.space/"]')).not.toBeNull();
  });

  it('shows the meeting facts', async () => {
    await mount(makeReport());
    expect(text()).toContain('Meeting report');
    expect(text()).toContain('abc-defg-hij');
    expect(text()).toContain('Duration: 23 minutes');
    expect(text()).toContain('3 lines');
  });

  it('shows the summary, action items with source quotes, decisions, questions, email and Q&A', async () => {
    await mount(makeReport());
    expect(text()).toContain('Current topic: Release planning');
    expect(text()).toContain('The team plans to release on Friday once the regression tests pass.');
    expect(text()).toContain('Release targeted for Friday');

    expect(text()).toContain('Update the API documentation');
    expect(text()).toContain('Owner: You');
    expect(text()).toContain('Due: Thursday');
    expect(text()).toContain('I will update the API documentation before then.');

    expect(text()).toContain('Release on Friday after regression tests');
    expect(text()).toContain('Who owns the rollback plan?');
    expect(text()).toContain('open');
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Follow-up email"]')!.value).toContain('Subject: Follow-up — Release planning');
    expect(text()).toContain('What did we decide?');
    expect(text()).toContain('Release on Friday.');
  });

  it('shows the full transcript by default, with time and speaker, and lets the user hide it', async () => {
    await mount(makeReport());
    const rows = container.querySelectorAll('.report-transcript li');
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent).toContain('1:02:05');
    expect(rows[2].textContent).toContain('You');
    expect(rows[2].textContent).toContain('I will update the API documentation before then.');

    await click(button(/^Hide transcript$/));
    expect(container.querySelectorAll('.report-transcript li')).toHaveLength(0);
    expect(button(/^Show transcript \(3 lines\)$/)).toBeDefined();
  });

  it('shows the transcript even when nothing has been analyzed', async () => {
    await mount(makeReport(NOTHING_RUN));
    expect(container.querySelectorAll('.report-transcript li')).toHaveLength(3);
  });

  describe('generating what is missing on the report page', () => {
    it('sends nothing to the AI until a button is pressed, and offers a button per missing section', async () => {
      const { provider, calls } = fakeProvider([]);
      await mount(makeReport(NOTHING_RUN), provider);
      expect(calls).toHaveLength(0);
      expect(text()).toContain('Not generated yet');
      for (const label of [/^Generate summary and analysis$/, /^Generate summary$/, /^Find action items$/, /^Find decisions$/, /^Find questions$/, /^Generate follow-up email$/]) {
        expect(button(label)).toBeDefined();
      }
    });

    it('generates the summary from the stored transcript and saves the updated report', async () => {
      const { provider, calls } = fakeProvider([summaryJson]);
      await mount(makeReport(NOTHING_RUN), provider);
      await click(button(/^Generate summary$/));

      expect(calls).toHaveLength(1);
      expect(calls[0].system).toContain('Summarize the meeting transcript');
      expect(calls[0].text).toContain('[1] John: We should release this on Friday after the regression tests.');
      expect(text()).toContain('The team plans a Friday release.');
      expect(text()).toContain('Current topic: Release planning');
      expect(saveReport).toHaveBeenLastCalledWith(expect.objectContaining({ summary: 'The team plans a Friday release.' }));
      expect(button(/^Generate summary$/)).toBeUndefined();
    });

    it('generates the summary and all analysis in one click, in order', async () => {
      const { provider, calls } = fakeProvider([summaryJson, actionsJson, decisionsJson, questionsJson]);
      await mount(makeReport(NOTHING_RUN), provider);
      await click(button(/^Generate summary and analysis$/));

      const kind = (system = ''): string => (system.includes('Summarize') ? 'summary'
        : system.includes('Extract action items') ? 'actions'
          : system.includes('Extract decisions') ? 'decisions' : 'questions');
      expect(calls.map((c) => kind(c.system))).toEqual(['summary', 'actions', 'decisions', 'questions']);
      expect(text()).toContain('Update the API documentation');
      expect(text()).toContain('Owner: You');
      expect(text()).toContain('Release on Friday');
      expect(text()).toContain('Who owns the rollback plan?');
      expect(button(/^Generate summary and analysis$/)).toBeUndefined();
    });

    it('says "none found" instead of offering to generate again once an analysis has run', async () => {
      const { provider } = fakeProvider([JSON.stringify({ decisions: [] })]);
      await mount(makeReport({ ...NOTHING_RUN }), provider);
      await click(button(/^Find decisions$/));
      expect(text()).toContain('No decisions found');
      expect(button(/^Find decisions$/)).toBeUndefined();
    });

    it('prepares the missing analysis before writing the follow-up email', async () => {
      const { provider, calls } = fakeProvider([summaryJson, actionsJson, decisionsJson, questionsJson, 'Subject: Follow-up — Release planning\n\nHi everyone,']);
      await mount(makeReport(NOTHING_RUN), provider);
      await click(button(/^Generate follow-up email$/));

      expect(calls).toHaveLength(5);
      expect(calls[4].system).toContain('follow-up email');
      expect(calls[4].text).toContain('Update the API documentation');
      expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Follow-up email"]')!.value).toContain('Subject: Follow-up — Release planning');
    });

    it('shows a readable error under the button and lets the user retry', async () => {
      const { provider } = fakeProvider([new Error('OpenRouter is rate limiting requests. Please wait and retry.'), summaryJson]);
      await mount(makeReport(NOTHING_RUN), provider);
      await click(button(/^Generate summary$/));
      expect(text()).toContain('OpenRouter is rate limiting requests');
      expect(text()).not.toContain('The team plans a Friday release.');

      await click(button(/^Generate summary$/));
      expect(text()).toContain('The team plans a Friday release.');
      expect(text()).not.toContain('rate limiting');
    });

    it('explains an AI reply that is not in the expected format', async () => {
      const { provider } = fakeProvider(['Here is a summary in plain prose.']);
      await mount(makeReport(NOTHING_RUN), provider);
      await click(button(/^Generate summary$/));
      expect(text()).toContain('not in the expected format');
    });

    it('offers no generate buttons when everything is already there', async () => {
      await mount(makeReport({ followUpEmail: 'Subject: x' }));
      expect(button(/^Generate summary and analysis$/)).toBeUndefined();
      expect(button(/^Generate follow-up email$/)).toBeUndefined();
    });
  });

  it('copies the summary, the transcript and the email', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount(makeReport());

    await click(button(/^Copy summary$/));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Release targeted for Friday'));
    await click(button(/^Copy transcript$/));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('[1:02:05] You: I will update the API documentation before then.'));
    expect(text()).toContain('Transcript copied');
    await click(button(/^Copy email$/));
    expect(writeText).toHaveBeenLastCalledWith('Subject: Follow-up — Release planning\n\nHi everyone,');
  });

  it('prints on request', async () => {
    const print = vi.fn();
    window.print = print;
    await mount(makeReport());
    await click(button(/Print/));
    expect(print).toHaveBeenCalled();
  });

  it('deletes the stored report and stops showing it', async () => {
    clear.mockResolvedValue(undefined);
    await mount(makeReport());
    await click(button(/^Delete this report$/));
    expect(clear).toHaveBeenCalled();
    expect(text()).toContain('This report was deleted');
    expect(text()).not.toContain('Update the API documentation');
  });
});
