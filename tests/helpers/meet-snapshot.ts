import type { MeetSnapshot } from '../../src/meet/types';

export function makeSnapshot(overrides: Partial<MeetSnapshot> = {}): MeetSnapshot {
  return {
    version: 1,
    page: { meetingDetected: true, meetingCode: 'abc-defg-hij', captions: 'on' },
    phase: 'idle',
    startedAt: null,
    endedAt: null,
    entryCount: 0,
    recentEntries: [],
    summary: null,
    keyPoints: [],
    topics: [],
    actionItems: [],
    decisions: [],
    questions: [],
    followUpEmail: null,
    qa: [],
    busy: {},
    errors: {},
    raw: {},
    unanalyzed: { summary: 0, actions: 0, decisions: 0, questions: 0 },
    analyzed: { summary: false, actions: false, decisions: false, questions: false },
    ...overrides,
  };
}
