import type { MeetReport } from '../../src/meet/types';

export function makeReport(overrides: Partial<MeetReport> = {}): MeetReport {
  return {
    generatedAt: Date.UTC(2026, 9, 9, 5, 30),
    meetingCode: 'abc-defg-hij',
    startedAt: 1_000_000,
    endedAt: 1_000_000 + 23 * 60_000 + 20_000,
    entries: [
      { id: 'e1', speaker: 'John', text: 'We should release this on Friday after the regression tests.', timestamp: 1_000_000 },
      { id: 'e2', speaker: 'Sarah', text: 'I agree. Who owns the rollback plan?', timestamp: 1_000_000 + 65_000 },
      { id: 'e3', speaker: 'You', text: 'I will update the API documentation before then.', timestamp: 1_000_000 + 3_725_000 },
    ],
    summary: 'The team plans to release on Friday once the regression tests pass.',
    keyPoints: ['Release targeted for Friday', 'Regression tests must pass first'],
    topics: ['Intro', 'Release planning'],
    actionItems: [{ id: 'a1', task: 'Update the API documentation', owner: 'You', deadline: 'Thursday', sourceEntryIds: ['e3'] }],
    decisions: [{ id: 'd1', decision: 'Release on Friday after regression tests', sourceEntryIds: ['e1'] }],
    questions: [{ id: 'q1', question: 'Who owns the rollback plan?', status: 'open', sourceEntryIds: ['e2'] }],
    followUpEmail: 'Subject: Follow-up — Release planning\n\nHi everyone,',
    qa: [{ id: 'qa1', question: 'What did we decide?', answer: 'Release on Friday.', error: null, pending: false }],
    analyzed: { summary: true, actions: true, decisions: true, questions: true },
    ...overrides,
  };
}
