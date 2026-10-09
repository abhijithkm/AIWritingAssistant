import { describe, expect, it, vi } from 'vitest';
import type { AIProvider, AIRequest } from '../src/shared/types';
import { MeetingAnalyzer } from '../src/meet/meeting-analyzer';
import { MeetingSession } from '../src/meet/meeting-state';
import type { CaptionEvent, CaptionsStatus, MeetPageStatus } from '../src/meet/types';

const summaryJson = (summary: string) => JSON.stringify({ summary, keyPoints: ['Point'], topics: ['Release'] });
const actionsJson = (...tasks: Array<[string, string | null, number]>) => JSON.stringify({
  actionItems: tasks.map(([task, owner, source]) => ({ task, owner, deadline: null, sources: [source] })),
});
const decisionsJson = JSON.stringify({ decisions: [{ decision: 'Release on Friday', sources: [1] }] });
const questionsJson = JSON.stringify({ questions: [{ question: 'Who owns rollback?', status: 'open', sources: [2] }] });

function setup(replies: Array<string | Error> = []) {
  const calls: AIRequest[] = [];
  const queue = [...replies];
  const provider: AIProvider = {
    async generate(request) {
      calls.push(request);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return { text: next ?? '' };
    },
  };
  return build(provider, calls);
}

function build(provider: AIProvider, calls: AIRequest[], limits: ConstructorParameters<typeof MeetingAnalyzer>[1] = {}) {
  const page: MeetPageStatus & { captions: CaptionsStatus } = { meetingDetected: true, meetingCode: 'abc-defg-hij', captions: 'on' };
  const observer = { started: 0, stopped: 0, start() { this.started += 1; }, stop() { this.stopped += 1; } };
  let handlers!: { onCaption(c: CaptionEvent): void };
  let clock = 1_000_000;
  const session = new MeetingSession({
    analyzer: new MeetingAnalyzer(provider, limits),
    detectPage: () => ({ ...page }),
    createObserver: (h) => { handlers = h; return observer; },
    getUserName: async () => 'Abhijith',
    now: () => clock,
  });
  let n = 0;
  const say = (speaker: string | undefined, text: string) => {
    n += 1;
    clock += 100_000;
    handlers.onCaption({ key: n, speaker, text, timestamp: clock });
  };
  // Same DOM block (same key) showing more text, as when one speaker keeps talking.
  const sayAs = (key: number, speaker: string | undefined, text: string) => {
    clock += 100_000;
    handlers.onCaption({ key, speaker, text, timestamp: clock });
  };
  return { session, page, observer, calls, say, sayAs, advance: (ms: number) => { clock += ms; } };
}

describe('MeetingSession lifecycle', () => {
  it('refuses to start away from a meeting page', () => {
    const { session, page, observer } = setup();
    page.meetingDetected = false;
    page.meetingCode = null;
    expect(() => session.start()).toThrow('Google Meet meeting');
    expect(session.snapshot().phase).toBe('idle');
    expect(observer.started).toBe(0);
  });

  it('records captions locally while active without ever calling the AI', () => {
    const { session, observer, say, calls } = setup();
    session.start();
    expect(session.snapshot().phase).toBe('active');
    expect(observer.started).toBe(1);
    for (let i = 1; i <= 50; i += 1) say('John', `Caption number ${i} is long enough to count.`);
    const snapshot = session.snapshot();
    expect(snapshot.entryCount).toBe(50);
    expect(snapshot.recentEntries.at(-1)?.speaker).toBe('John');
    expect(calls).toHaveLength(0);
  });

  it('sends only the newest entries to the popup but keeps the full count', () => {
    const { session, say } = setup();
    session.start();
    for (let i = 1; i <= 150; i += 1) say('John', `Caption number ${i} is long enough to count.`);
    const snapshot = session.snapshot();
    expect(snapshot.entryCount).toBe(150);
    expect(snapshot.recentEntries).toHaveLength(100);
    expect(snapshot.recentEntries.at(-1)?.id).toBe('e150');
  });

  it('bumps the version only when something visible changes and notifies listeners', () => {
    const { session, page, say } = setup();
    let notified = 0;
    session.onChange(() => { notified += 1; });
    session.start();
    const afterStart = session.snapshot().version;
    say('John', 'We should release on Friday.');
    const afterCaption = session.snapshot().version;
    expect(afterCaption).toBeGreaterThan(afterStart);
    expect(notified).toBeGreaterThan(0);

    session.refreshPage();
    expect(session.snapshot().version).toBe(afterCaption);
    page.captions = 'off';
    session.refreshPage();
    expect(session.snapshot().version).toBeGreaterThan(afterCaption);
    expect(session.snapshot().page.captions).toBe('off');
  });

  it('stops observing but keeps the transcript, and resumes in the same meeting', () => {
    const { session, observer, say } = setup();
    session.start();
    const startedAt = session.snapshot().startedAt;
    say('John', 'We should release on Friday.');
    session.stop();
    let snapshot = session.snapshot();
    expect(observer.stopped).toBe(1);
    expect(snapshot.phase).toBe('stopped');
    expect(snapshot.entryCount).toBe(1);
    expect(snapshot.endedAt).not.toBeNull();

    session.start();
    snapshot = session.snapshot();
    expect(snapshot.phase).toBe('active');
    expect(snapshot.entryCount).toBe(1);
    expect(snapshot.startedAt).toBe(startedAt);
    expect(snapshot.endedAt).toBeNull();
  });

  it('stops when the user navigates to another meeting or leaves, but keeps what was captured', () => {
    const { session, page, say } = setup();
    session.start();
    say('John', 'We should release on Friday.');
    page.meetingCode = 'xyz-wxyz-abc';
    session.handleNavigation();
    let snapshot = session.snapshot();
    expect(snapshot.phase).toBe('stopped');
    expect(snapshot.notice).toContain('left');
    expect(snapshot.entryCount).toBe(1);

    // Starting in the new meeting begins a fresh transcript.
    session.start();
    snapshot = session.snapshot();
    expect(snapshot.phase).toBe('active');
    expect(snapshot.entryCount).toBe(0);
    expect(snapshot.notice).toBeUndefined();

    page.meetingDetected = false;
    page.meetingCode = null;
    session.handleNavigation();
    expect(session.snapshot().phase).toBe('stopped');
  });

  it('discards everything on request', async () => {
    const { session, observer, say } = setup([summaryJson('First.')]);
    session.start();
    say('John', 'We should release on Friday.');
    await session.analyze('summary');
    session.discard();
    const snapshot = session.snapshot();
    expect(observer.stopped).toBe(1);
    expect(snapshot.phase).toBe('idle');
    expect(snapshot.entryCount).toBe(0);
    expect(snapshot.summary).toBeNull();
    expect(snapshot.qa).toEqual([]);
  });

  it('exposes the full state in the documented shape', () => {
    const { session, say } = setup();
    session.start();
    say('John', 'We should release on Friday.');
    const state = session.getState();
    expect(state).toMatchObject({ isActive: true, meetingCode: 'abc-defg-hij', decisions: [], actionItems: [], questions: [], summary: null });
    expect(state.entries).toHaveLength(1);
    expect(state.startedAt).not.toBeNull();
  });

  it('builds a full report with every transcript line, not just the newest ones', async () => {
    const { session, say } = setup([summaryJson('First.'), actionsJson(['Update docs', 'You', 1])]);
    session.start();
    for (let i = 1; i <= 2; i += 1) say('John', `Caption number ${i} is long enough to count.`);
    await session.analyze('summary');
    await session.analyze('actions');
    for (let i = 3; i <= 150; i += 1) say('John', `Caption number ${i} is long enough to count.`);
    session.stop();
    await session.ask('Anything?');

    const report = session.getReport();
    expect(report.entries).toHaveLength(150);
    expect(report.entries.at(-1)?.id).toBe('e150');
    expect(report).toMatchObject({ meetingCode: 'abc-defg-hij', summary: 'First.', keyPoints: ['Point'], topics: ['Release'] });
    expect(report.actionItems.map((a) => a.task)).toEqual(['Update docs']);
    expect(report.startedAt).not.toBeNull();
    expect(report.endedAt).not.toBeNull();
    expect(report.generatedAt).toBeGreaterThan(0);
    // Tells the report page which analyses already ran, so "found nothing" is not shown as "not run yet".
    expect(report.analyzed).toEqual({ summary: true, actions: true, decisions: false, questions: false });
    // Unanswered questions (here the AI returned nothing useful) are left out of the report.
    expect(report.qa.every((item) => item.answer)).toBe(true);
  });

  it('builds copyable transcript text', () => {
    const { session, say } = setup();
    session.start();
    say('John', 'We should release on Friday.');
    expect(session.getTranscriptText()).toContain('Google Meet transcript (captions) — abc-defg-hij');
    expect(session.getTranscriptText()).toContain('John: We should release on Friday.');
  });
});

describe('MeetingSession analysis', () => {
  it('explains an empty transcript instead of calling the AI', async () => {
    const { session, calls } = setup();
    session.start();
    await session.analyze('summary');
    expect(session.snapshot().errors.summary).toContain('no transcript');
    expect(calls).toHaveLength(0);
  });

  it('summarizes incrementally: unchanged transcripts cost nothing, new lines are sent alone', async () => {
    const { session, say, calls } = setup([summaryJson('First.'), summaryJson('Second.'), summaryJson('Combined.')]);
    session.start();
    say('John', 'We should release on Friday.');
    say('Sarah', 'I agree with that plan.');
    expect(session.snapshot().unanalyzed.summary).toBe(2);

    await session.analyze('summary');
    let snapshot = session.snapshot();
    expect(snapshot.summary).toBe('First.');
    expect(snapshot.keyPoints).toEqual(['Point']);
    expect(snapshot.topics).toEqual(['Release']);
    expect(snapshot.unanalyzed.summary).toBe(0);
    expect(calls).toHaveLength(1);

    await session.analyze('summary');
    expect(calls).toHaveLength(1);

    say('John', 'One more thing about rollback.');
    expect(session.snapshot().unanalyzed.summary).toBe(1);
    await session.analyze('summary');
    snapshot = session.snapshot();
    expect(calls).toHaveLength(3);
    expect(calls[1].text).toBe('<transcript>\n[3] John: One more thing about rollback.\n</transcript>');
    expect(snapshot.summary).toBe('Combined.');
  });

  it('re-analyzes an entry that grew after it was analyzed (one speaker talking on)', async () => {
    const { session, sayAs, calls } = setup([
      actionsJson(['Launch on Friday', null, 1]),
      actionsJson(['Bob owns the rollout plan', 'Bob', 1]),
    ]);
    session.start();
    sayAs(1, 'John', 'We decided to launch on Friday');
    await session.analyze('actions');
    expect(session.snapshot().unanalyzed.actions).toBe(0);

    sayAs(1, 'John', 'We decided to launch on Friday and Bob owns the rollout plan');
    expect(session.snapshot().entryCount).toBe(1);
    expect(session.snapshot().unanalyzed.actions).toBe(1);
    await session.analyze('actions');
    expect(calls).toHaveLength(2);
    expect(calls[1].text).toContain('Bob owns the rollout plan');
    expect(session.snapshot().actionItems.map((item) => item.task)).toEqual(['Launch on Friday', 'Bob owns the rollout plan']);
  });

  it('rebuilds the summary part that covered text which has since grown', async () => {
    const { session, sayAs, calls } = setup([summaryJson('First.'), summaryJson('Updated.')]);
    session.start();
    sayAs(1, 'John', 'We decided to launch on Friday');
    await session.analyze('summary');
    sayAs(1, 'John', 'We decided to launch on Friday and Bob owns the rollout plan');
    await session.analyze('summary');

    expect(calls).toHaveLength(2);
    expect(calls[1].text).toContain('[1] John: We decided to launch on Friday and Bob owns the rollout plan');
    expect(session.snapshot().summary).toBe('Updated.');
    expect(session.snapshot().unanalyzed.summary).toBe(0);
  });

  it('keeps earlier summary parts when only the newest entry grew', async () => {
    // Run 1: one chunk. Run 2: a chunk plus a combine. Run 3: the rebuilt chunk plus a combine.
    const { session, sayAs, calls } = setup([
      summaryJson('Part A.'),
      summaryJson('Part B.'), summaryJson('Combined once.'),
      summaryJson('Part B updated.'), summaryJson('Combined.'),
    ]);
    session.start();
    sayAs(1, 'John', 'We decided to launch on Friday');
    await session.analyze('summary');
    sayAs(2, 'Sarah', 'I will draft the announcement');
    await session.analyze('summary');
    sayAs(2, 'Sarah', 'I will draft the announcement and send it Thursday');
    await session.analyze('summary');

    // Third run: part A is reused, part B is rebuilt from the grown entry, then both are combined.
    expect(calls).toHaveLength(5);
    expect(calls[3].text).toBe('<transcript>\n[2] Sarah: I will draft the announcement and send it Thursday\n</transcript>');
    expect(calls[4].text).toContain('Part A.');
    expect(calls[4].text).toContain('Part B updated.');
    expect(calls[4].text).not.toContain('"Part B."');
    expect(session.snapshot().summary).toBe('Combined.');
  });

  it('reports which analyses have run at least once', async () => {
    const { session, say } = setup([actionsJson()]);
    session.start();
    say('John', 'We should release on Friday.');
    expect(session.snapshot().analyzed).toEqual({ summary: false, actions: false, decisions: false, questions: false });
    await session.analyze('actions');
    expect(session.snapshot().analyzed).toEqual({ summary: false, actions: true, decisions: false, questions: false });
  });

  it('stops sending further chunk requests once the assistant is stopped', async () => {
    const calls: AIRequest[] = [];
    let stopNow: () => void = () => undefined;
    const provider: AIProvider = {
      async generate(request) {
        calls.push(request);
        stopNow();
        return { text: summaryJson('Part.') };
      },
    };
    const { session, say } = build(provider, calls, { chunkMaxChars: 100, chunkMaxSpanMs: 600_000 });
    stopNow = () => session.stop();
    session.start();
    for (let i = 0; i < 3; i += 1) say('John', `Long line number ${i} with some padding text here.`);
    await session.analyze('summary');

    expect(calls).toHaveLength(1);
    expect(session.snapshot().summary).toBeNull();
  });

  it('passes the saved user name to the model', async () => {
    const { session, say, calls } = setup([summaryJson('First.')]);
    session.start();
    say('You', 'I will update the docs.');
    await session.analyze('summary');
    expect(calls[0].system).toContain('Abhijith');
  });

  it('extracts action items with source ids and merges repeats found in the overlap', async () => {
    const { session, say } = setup([
      actionsJson(['Update API documentation', 'Abhijith', 1]),
      actionsJson(['Update API documentation.', 'Abhijith', 1], ['Write release notes', null, 3]),
    ]);
    session.start();
    say('Abhijith', 'I will update the API documentation.');
    say('Sarah', 'Great.');
    await session.analyze('actions');
    expect(session.snapshot().actionItems).toEqual([
      { id: 'a1', task: 'Update API documentation', owner: 'Abhijith', deadline: undefined, sourceEntryIds: ['e1'] },
    ]);

    say('Sarah', 'Someone should write the release notes.');
    await session.analyze('actions');
    const items = session.snapshot().actionItems;
    expect(items.map((i) => i.task)).toEqual(['Update API documentation', 'Write release notes']);
    expect(items[0].id).toBe('a1');
    expect(items[1].id).toBe('a2');
    expect(items[1].owner).toBeUndefined();
  });

  it('extracts decisions and questions', async () => {
    const { session, say } = setup([decisionsJson, questionsJson]);
    session.start();
    say('John', 'We release on Friday.');
    say('Sarah', 'Who owns the rollback plan?');
    await session.analyze('decisions');
    await session.analyze('questions');
    const snapshot = session.snapshot();
    expect(snapshot.decisions).toEqual([{ id: 'd1', decision: 'Release on Friday', sourceEntryIds: ['e1'] }]);
    expect(snapshot.questions).toEqual([{ id: 'q1', question: 'Who owns rollback?', status: 'open', sourceEntryIds: ['e2'] }]);
  });

  it('shows the raw reply and leaves the transcript unanalyzed when the AI reply is malformed', async () => {
    const { session, say } = setup(['Sure, here is a summary in prose.']);
    session.start();
    say('John', 'We should release on Friday.');
    await session.analyze('summary');
    const snapshot = session.snapshot();
    expect(snapshot.raw.summary).toBe('Sure, here is a summary in prose.');
    expect(snapshot.errors.summary).toContain('expected format');
    expect(snapshot.summary).toBeNull();
    expect(snapshot.unanalyzed.summary).toBe(1);
    expect(snapshot.busy.summary).toBeFalsy();
  });

  it('reports provider errors per task and recovers on retry', async () => {
    const { session, say } = setup([
      new Error('OpenRouter is rate limiting requests. Please wait and retry.'),
      actionsJson(['Update docs', 'Abhijith', 1]),
    ]);
    session.start();
    say('Abhijith', 'I will update the docs.');
    await session.analyze('actions');
    expect(session.snapshot().errors.actions).toContain('rate limiting');
    expect(session.snapshot().actionItems).toEqual([]);

    await session.analyze('actions');
    expect(session.snapshot().errors.actions).toBeUndefined();
    expect(session.snapshot().actionItems).toHaveLength(1);
  });

  it('ignores a reply that arrives after the assistant was stopped', async () => {
    let release!: (text: string) => void;
    const calls: AIRequest[] = [];
    const provider: AIProvider = {
      generate(request) {
        calls.push(request);
        return new Promise((resolve) => { release = (text) => resolve({ text }); });
      },
    };
    const { session, say } = build(provider, calls);
    session.start();
    say('John', 'We should release on Friday.');
    const pending = session.analyze('summary');
    expect(session.snapshot().busy.summary).toBe(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    session.stop();
    expect(session.snapshot().busy.summary).toBeFalsy();
    release(summaryJson('Too late.'));
    await pending;
    expect(session.snapshot().summary).toBeNull();
    expect(session.snapshot().unanalyzed.summary).toBe(1);
  });

  it('runs AI requests one at a time', async () => {
    let active = 0;
    let peak = 0;
    const provider: AIProvider = {
      async generate() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { text: '{"actionItems": [], "decisions": [], "questions": []}' };
      },
    };
    const { session, say } = build(provider, []);
    session.start();
    say('John', 'We should release on Friday.');
    await Promise.all([session.analyze('actions'), session.analyze('decisions'), session.ask('What happened?')]);
    expect(peak).toBe(1);
  });
});

describe('MeetingSession questions', () => {
  it('answers a question from the transcript and keeps the history', async () => {
    const { session, say, calls } = setup(['The team agreed to release on Friday.']);
    session.start();
    say('John', 'We should release on Friday.');
    const pending = session.ask('What did we decide?');
    expect(session.snapshot().qa[0]).toMatchObject({ question: 'What did we decide?', pending: true });
    expect(session.snapshot().busy.ask).toBe(true);
    await pending;
    const snapshot = session.snapshot();
    expect(snapshot.qa[0]).toMatchObject({ answer: 'The team agreed to release on Friday.', error: null, pending: false });
    expect(snapshot.busy.ask).toBeFalsy();
    expect(calls[0].text).toContain('Question: What did we decide?');
  });

  it('records an error for the question when the AI fails or the transcript is empty', async () => {
    const { session, say, calls } = setup([new Error('Could not reach OpenRouter. Check your internet connection and try again.')]);
    session.start();
    await session.ask('Anything?');
    expect(session.snapshot().qa[0].error).toContain('no transcript');
    expect(calls).toHaveLength(0);

    say('John', 'We should release on Friday.');
    await session.ask('What did we decide?');
    expect(session.snapshot().qa[1].error).toContain('Could not reach OpenRouter');
  });

  it('includes the analysis so far as notes for the model', async () => {
    const { session, say, calls } = setup([summaryJson('The team planned a release.'), 'Answer.']);
    session.start();
    say('John', 'We should release on Friday.');
    await session.analyze('summary');
    await session.ask('What is the plan?');
    expect(calls[1].text).toContain('Summary: The team planned a release.');
  });

  it('marks a pending question as cancelled when the assistant is stopped', async () => {
    let release!: (text: string) => void;
    const calls: AIRequest[] = [];
    const provider: AIProvider = {
      generate: (request) => {
        calls.push(request);
        return new Promise((resolve) => { release = (text) => resolve({ text }); });
      },
    };
    const { session, say } = build(provider, calls);
    session.start();
    say('John', 'We should release on Friday.');
    const pending = session.ask('What did we decide?');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    session.stop();
    release('Late answer.');
    await pending;
    expect(session.snapshot().qa[0]).toMatchObject({ pending: false, answer: null });
    expect(session.snapshot().qa[0].error).toContain('stopped');
  });
});

describe('MeetingSession follow-up email', () => {
  it('prepares any missing analysis first, then writes the email from it', async () => {
    const { session, say, calls } = setup([
      summaryJson('The team planned a release.'),
      actionsJson(['Update API documentation', 'Abhijith', 1]),
      decisionsJson,
      questionsJson,
      'Subject: Follow-up — Release\n\nHi everyone,',
    ]);
    session.start();
    say('Abhijith', 'I will update the API documentation.');
    say('Sarah', 'Who owns the rollback plan?');
    session.stop();
    await session.analyze('email');

    const snapshot = session.snapshot();
    expect(calls).toHaveLength(5);
    expect(snapshot.followUpEmail).toBe('Subject: Follow-up — Release\n\nHi everyone,');
    expect(snapshot.summary).toBe('The team planned a release.');
    expect(snapshot.actionItems).toHaveLength(1);
    expect(snapshot.decisions).toHaveLength(1);
    expect(snapshot.questions).toHaveLength(1);
    expect(calls[4].text).toContain('Update API documentation');
    expect(calls[4].system).toContain('Regards,\nAbhijith');
  });

  it('only rewrites the email when the analysis is already current', async () => {
    const { session, say, calls } = setup([
      summaryJson('S.'), actionsJson(), decisionsJson, questionsJson, 'Subject: Follow-up — Meeting\n\nOne',
      'Subject: Follow-up — Meeting\n\nTwo',
    ]);
    session.start();
    say('John', 'We should release on Friday.');
    session.stop();
    await session.analyze('email');
    await session.analyze('email');
    expect(calls).toHaveLength(6);
    expect(session.snapshot().followUpEmail).toContain('Two');
  });

  it('stops and reports the error if preparing the analysis fails', async () => {
    const { session, say, calls } = setup([new Error('OpenRouter is rate limiting requests. Please wait and retry.')]);
    session.start();
    say('John', 'We should release on Friday.');
    session.stop();
    await session.analyze('email');
    expect(calls).toHaveLength(1);
    expect(session.snapshot().errors.email).toContain('rate limiting');
    expect(session.snapshot().followUpEmail).toBeNull();
  });
});
