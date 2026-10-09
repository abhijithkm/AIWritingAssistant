import { describe, expect, it } from 'vitest';
import { formatDuration, formatMeetingSummary, formatTranscript } from '../src/meet/export-format';

describe('formatTranscript', () => {
  it('prints a header and one line per entry with a time offset from the start', () => {
    const text = formatTranscript(
      [
        { id: 'e1', speaker: 'John', text: 'We should release Friday.', timestamp: 10_000 },
        { id: 'e2', speaker: undefined, text: 'Sounds good.', timestamp: 10_000 + 65_000 },
        { id: 'e3', speaker: 'You', text: 'Late addition.', timestamp: 10_000 + 3_725_000 },
      ],
      { startedAt: 10_000, meetingCode: 'abc-defg-hij' },
    );
    expect(text).toBe([
      'Google Meet transcript (captions) — abc-defg-hij',
      '[00:00] John: We should release Friday.',
      '[01:05] Unknown speaker: Sounds good.',
      '[1:02:05] You: Late addition.',
    ].join('\n'));
  });

  it('falls back to the first entry as the start and omits a missing code', () => {
    const text = formatTranscript([{ id: 'e1', speaker: 'A', text: 'Hi.', timestamp: 5_000 }], { startedAt: null, meetingCode: null });
    expect(text).toBe('Google Meet transcript (captions)\n[00:00] A: Hi.');
  });
});

describe('formatMeetingSummary', () => {
  it('lists every section that has content and skips empty ones', () => {
    const text = formatMeetingSummary({
      summary: 'The team planned a release.',
      keyPoints: ['Release on Friday'],
      topics: ['Release planning'],
      decisions: [{ id: 'd1', decision: 'Release on Friday', sourceEntryIds: [] }],
      actionItems: [
        { id: 'a1', task: 'Update API documentation', owner: 'Abhijith', deadline: 'Thursday', sourceEntryIds: [] },
        { id: 'a2', task: 'Write release notes', sourceEntryIds: [] },
      ],
      questions: [{ id: 'q1', question: 'Who owns rollback?', status: 'open', sourceEntryIds: [] }],
    });
    expect(text).toBe([
      'Summary:',
      'The team planned a release.',
      '',
      'Topics: Release planning',
      '',
      'Key points:',
      '- Release on Friday',
      '',
      'Decisions:',
      '- Release on Friday',
      '',
      'Action items:',
      '- Update API documentation (Owner: Abhijith, Due: Thursday)',
      '- Write release notes',
      '',
      'Questions:',
      '- Who owns rollback? [open]',
    ].join('\n'));
  });

  it('returns an empty string when there is nothing to copy', () => {
    expect(formatMeetingSummary({ summary: null, keyPoints: [], topics: [], decisions: [], actionItems: [], questions: [] })).toBe('');
  });
});

describe('formatDuration', () => {
  it('rounds to whole minutes and handles short or missing spans', () => {
    expect(formatDuration(0, 23 * 60_000 + 20_000)).toBe('23 minutes');
    expect(formatDuration(0, 60_000)).toBe('1 minute');
    expect(formatDuration(0, 20_000)).toBe('less than a minute');
    expect(formatDuration(null, 20_000)).toBe('unknown');
    expect(formatDuration(5_000, null)).toBe('unknown');
  });
});
