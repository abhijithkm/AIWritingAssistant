import type { ActionItem, Decision, MeetSnapshot, Question, TranscriptEntry } from './types';

export function formatClock(offsetMs: number): string {
  const total = Math.max(0, Math.floor(offsetMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatTranscript(
  entries: readonly TranscriptEntry[],
  meeting: { startedAt: number | null; meetingCode: string | null },
): string {
  const start = meeting.startedAt ?? entries[0]?.timestamp ?? 0;
  const header = `Google Meet transcript (captions)${meeting.meetingCode ? ` — ${meeting.meetingCode}` : ''}`;
  const lines = entries.map((entry) => `[${formatClock(entry.timestamp - start)}] ${entry.speaker ?? 'Unknown speaker'}: ${entry.text}`);
  return [header, ...lines].join('\n');
}

/** "Lines #3, #5" for the entry ids an analysis cites. */
export function formatLineRefs(ids: readonly string[]): string {
  return `Lines ${ids.map((id) => `#${id.replace(/^e/, '')}`).join(', ')}`;
}

function actionLine({ task, owner, deadline }: ActionItem): string {
  const details = [owner ? `Owner: ${owner}` : '', deadline ? `Due: ${deadline}` : ''].filter(Boolean).join(', ');
  return `- ${task}${details ? ` (${details})` : ''}`;
}

function questionLine({ question, status }: Question): string {
  return `- ${question}${status && status !== 'unknown' ? ` [${status}]` : ''}`;
}

export function formatMeetingSummary(
  snapshot: Pick<MeetSnapshot, 'summary' | 'keyPoints' | 'topics'> & { decisions: Decision[]; actionItems: ActionItem[]; questions: Question[] },
): string {
  const sections: string[] = [];
  if (snapshot.summary) sections.push(`Summary:\n${snapshot.summary}`);
  if (snapshot.topics.length) sections.push(`Topics: ${snapshot.topics.join('; ')}`);
  if (snapshot.keyPoints.length) sections.push(`Key points:\n${snapshot.keyPoints.map((point) => `- ${point}`).join('\n')}`);
  if (snapshot.decisions.length) sections.push(`Decisions:\n${snapshot.decisions.map(({ decision }) => `- ${decision}`).join('\n')}`);
  if (snapshot.actionItems.length) sections.push(`Action items:\n${snapshot.actionItems.map(actionLine).join('\n')}`);
  if (snapshot.questions.length) sections.push(`Questions:\n${snapshot.questions.map(questionLine).join('\n')}`);
  return sections.join('\n\n');
}

export function formatDuration(startedAt: number | null, endedAt: number | null): string {
  if (startedAt === null || endedAt === null) return 'unknown';
  const minutes = Math.round((endedAt - startedAt) / 60_000);
  if (minutes < 1) return 'less than a minute';
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
